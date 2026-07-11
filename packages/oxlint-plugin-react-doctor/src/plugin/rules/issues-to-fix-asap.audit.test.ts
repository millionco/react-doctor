import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { noGiantComponent } from "./architecture/no-giant-component.js";
import { clientLocalstorageNoVersion } from "./client/client-localstorage-no-version.js";
import { jsFlatmapFilter } from "./js-performance/js-flatmap-filter.js";
import { exhaustiveDeps } from "./react-builtins/exhaustive-deps.js";
import { authTokenInWebStorage } from "./security/auth-token-in-web-storage.js";
import { noSecretsInClientCode } from "./security/no-secrets-in-client-code.js";
import { noDerivedState } from "./state-and-effects/no-derived-state.js";
import { noEventHandler } from "./state-and-effects/no-event-handler.js";
import { rerenderStateOnlyInHandlers } from "./state-and-effects/rerender-state-only-in-handlers.js";

describe("ISSUES_TO_FIX_ASAP audit", () => {
  it("accepts complete prop member dependencies", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Settings(props) {
        useEffect(() => consume(props?.apiKeys), [props.apiKeys]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a complete dependency on another memo result", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Settings(props) {
        const [localApiKeys] = useState([]);
        const apiKeys = useMemo(() => [...props.apiKeys, ...localApiKeys], [props.apiKeys, localApiKeys]);
        const apiKeyRows = useMemo(() => apiKeys.map((apiKey) => apiKey.id), [apiKeys]);
        return apiKeyRows;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts an intentional every-commit layout effect", () => {
    const result = runRule(
      exhaustiveDeps,
      `function VisualContext() {
        const [visualContext, setVisualContext] = useState("");
        useLayoutEffect(() => {
          const next = readAncestorClass();
          setVisualContext((previous) => previous === next ? previous : next);
        });
        return visualContext;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still rejects a non-converging every-commit state update", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Counter({ enabled }) {
        const [count, setCount] = useState(0);
        useEffect(() => setCount((previous) => enabled ? previous : previous + 1));
        return count;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("detects prop-derived state copied through a ref", () => {
    const result = runRule(
      noDerivedState,
      `function Settings(props) {
        const incomingApiKeysRef = useRef(props.apiKeys);
        const [apiKeys, setApiKeys] = useState([]);
        useEffect(() => {
          incomingApiKeysRef.current = props.apiKeys;
        }, [props.apiKeys]);
        useEffect(() => {
          setApiKeys(incomingApiKeysRef.current);
        }, [props.apiKeys]);
        return apiKeys.length;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps DOM and externally assigned refs out of derived-state provenance", () => {
    const domResult = runRule(
      noDerivedState,
      `function Panel() {
        const elementRef = useRef(null);
        const [width, setWidth] = useState(0);
        useLayoutEffect(() => setWidth(elementRef.current.getBoundingClientRect().width), []);
        return <div ref={elementRef}>{width}</div>;
      }`,
    );
    const externalResult = runRule(
      noDerivedState,
      `function Panel({ source }) {
        const valueRef = useRef(source);
        const [value, setValue] = useState(0);
        useEffect(() => { valueRef.current = readExternalValue(); }, []);
        useEffect(() => setValue(valueRef.current), [source]);
        return value;
      }`,
    );
    expect(domResult.parseErrors).toEqual([]);
    expect(externalResult.parseErrors).toEqual([]);
    expect(domResult.diagnostics).toEqual([]);
    expect(externalResult.diagnostics).toEqual([]);
  });

  it("accepts state read through render-time merging and JSX conditions", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Settings({ apiKeys }) {
        const [localApiKeys, setLocalApiKeys] = useState([]);
        const [pendingCount, setPendingCount] = useState(0);
        const [error, setError] = useState(null);
        const mergedById = new Map(apiKeys.map((apiKey) => [apiKey.id, apiKey]));
        localApiKeys.forEach((apiKey) => mergedById.set(apiKey.id, apiKey));
        const createApiKey = async () => {
          setPendingCount((count) => count + 1);
          try {
            const createdApiKey = await createKey();
            setLocalApiKeys((current) => [...current, createdApiKey]);
          }
          catch (nextError) { setError(nextError); }
          finally { setPendingCount((count) => count - 1); }
        };
        return <main>{pendingCount > 0 && <p>Saving</p>}{error && <p>{error.message}</p>}{[...mergedById.values()].map((key) => <div>{key.id}</div>)}</main>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts product API-key records in a product-scoped session key", () => {
    const result = runRule(
      authTokenInWebStorage,
      `const records = [{ id: "1", key: "mk_test", status: "active", createdAt: new Date() }];
       sessionStorage.setItem("mailing.createdApiKeys", JSON.stringify(records));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still rejects actual API-key credential storage", () => {
    const result = runRule(authTokenInWebStorage, `localStorage.setItem("auth.apiKey", apiKey);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a browser-storage namespace constant", () => {
    const result = runRule(
      noSecretsInClientCode,
      `"use client";
       const LOCAL_API_KEYS_STORAGE_KEY = "mailing.createdApiKeys";
       const existing = sessionStorage.getItem(LOCAL_API_KEYS_STORAGE_KEY);
       sessionStorage.setItem(LOCAL_API_KEYS_STORAGE_KEY, existing ?? "[]");`,
      { filename: "src/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts defensively decoded session storage without a version suffix", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `const STORAGE_KEY = "mailing.createdApiKeys";
       function readRecords() {
         try {
           const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
           return Array.isArray(parsed) && parsed.every((record) =>
             typeof record.id === "string" && typeof record.key === "string" &&
             typeof record.status === "string" && !Number.isNaN(Date.parse(record.createdAt)))
             ? parsed : [];
         } catch { return []; }
       }
       sessionStorage.setItem(STORAGE_KEY, JSON.stringify(readRecords()));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `levels.slice(0, index).map((level) => level.selected).filter(Boolean);`,
    `search.split(",").map((token) => token.trim()).filter(Boolean);`,
  ])("accepts bounded UI map/filter pipelines", (code) => {
    const result = runRule(jsFlatmapFilter, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps no-event-handler stable when unrelated callback props are added", () => {
    const base = `function Cascader(props) {
      const [activeIndex, setActiveIndex] = useState(0);
      useEffect(() => { if (activeIndex >= 0) props.onTabsChange(activeIndex); }, [activeIndex]);
      return null;
    }`;
    const head = `function Cascader({ onTabsChange, loadData, onLoadError }) {
      const [activeIndex, setActiveIndex] = useState(0);
      useEffect(() => { if (activeIndex >= 0) onTabsChange(activeIndex); }, [activeIndex]);
      return null;
    }`;
    const baseResult = runRule(noEventHandler, base);
    const headResult = runRule(noEventHandler, head);
    expect(baseResult.parseErrors).toEqual([]);
    expect(headResult.parseErrors).toEqual([]);
    expect(headResult.diagnostics).toHaveLength(baseResult.diagnostics.length);
  });

  it("accepts read-only state initialization", () => {
    const result = runRule(
      noEventHandler,
      `function useSurveyManager(initialData) {
        const [isEditMode] = useState(Boolean(initialData));
        useEffect(() => { if (isEditMode) restoreSurvey(); }, [isEditMode]);
        return isEditMode;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts session-storage synchronization", () => {
    const result = runRule(
      noEventHandler,
      `function useSurveyManager() {
        const [title, setTitle] = useState("");
        const [questions, setQuestions] = useState([]);
        useEffect(() => {
          sessionStorage.setItem("survey-draft", JSON.stringify({ title, questions }));
        }, [title, questions]);
        return { setTitle, setQuestions };
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps giant-component diagnostic identity stable as line count changes", () => {
    const buildComponent = (statementCount: number) =>
      `function ReactPhotoEditor() {\n${Array.from(
        { length: statementCount },
        (_, statementIndex) => `const value${statementIndex} = ${statementIndex};`,
      ).join("\n")}\nreturn <main />;\n}`;
    const before = runRule(noGiantComponent, buildComponent(468));
    const after = runRule(noGiantComponent, buildComponent(467));
    expect(before.parseErrors).toEqual([]);
    expect(after.parseErrors).toEqual([]);
    expect(before.diagnostics).toHaveLength(1);
    expect(after.diagnostics).toHaveLength(1);
    expect(after.diagnostics[0]?.message).toBe(before.diagnostics[0]?.message);
  });
});
