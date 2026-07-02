import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInitializeState } from "./no-initialize-state.js";

describe("no-initialize-state — regressions", () => {
  it("stays silent when a mount effect seeds a non-deterministic id", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [id, setId] = useState(null);
        useEffect(() => { setId(crypto.randomUUID()); }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for Math.random / Date.now seeds", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [seed, setSeed] = useState(0);
        const [at, setAt] = useState(0);
        useEffect(() => { setSeed(Math.random()); setAt(Date.now()); }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a deterministic literal init from a mount effect", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [n, setN] = useState(0);
        useEffect(() => { setN(42); }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a storage-seeded mount init (bench: digitalocean sea-notes Theme)", () => {
    const result = runRule(
      noInitializeState,
      `function MaterialThemeProvider({ children }) {
        const [mode, setMode] = useState('light');
        const [currentTheme, setCurrentTheme] = useState('modernize');
        useEffect(() => {
          if (typeof window !== 'undefined') {
            const storedMode = localStorage.getItem('themeMode');
            const storedTheme = localStorage.getItem('currentTheme') || 'modernize';
            if (storedMode && storedMode !== mode) setMode(storedMode);
            if (storedTheme !== currentTheme) setCurrentTheme(storedTheme);
          }
        }, []);
        return children;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a sessionStorage draft load with deterministic fallbacks (bench: formslab)", () => {
    const result = runRule(
      noInitializeState,
      `function useCreateSurveyManager(initialData) {
        const { setActivePage } = useApplicationContext();
        const [isEditMode] = useState(Boolean(initialData));
        const [title, setTitle] = useState('My survey');
        const [isLoaded, setIsLoaded] = useState(isEditMode);
        const [questions, setQuestions] = useState([]);
        const [surveyOptions, setSurveyOptions] = useState({});
        useEffect(() => {
          setActivePage(isEditMode ? Page.EDIT_SURVEY : Page.CREATE_SURVEY);
          if (!isEditMode && typeof window !== 'undefined') {
            const draftSurvey = sessionStorage.getItem(DRAFT_SURVEY_SESSION_STORAGE);
            if (draftSurvey) {
              const { title, questions, surveyOptions } = JSON.parse(draftSurvey);
              if (title !== undefined) setTitle(title);
              if (questions !== undefined) setQuestions(questions);
              if (surveyOptions !== undefined) setSurveyOptions(surveyOptions);
            } else {
              setTitle(USER_FEEDBACK_TEMPLATE.title);
              setQuestions(USER_FEEDBACK_TEMPLATE.questions);
            }
            setIsLoaded(true);
          } else if (isEditMode) {
            setIsLoaded(true);
          }
          return () => {
            setActivePage(undefined);
          };
        }, []);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags literal flag inits beside interval-ref bookkeeping (bench: bradgarropy use-countdown)", () => {
    const result = runRule(
      noInitializeState,
      `function useCountdown() {
        const [isActive, setIsActive] = useState(false);
        const [isInactive, setIsInactive] = useState(true);
        const [isRunning, setIsRunning] = useState(false);
        const id = useRef(0);
        useEffect(() => {
          setIsActive(true);
          setIsInactive(false);
          setIsRunning(true);
          id.current = window.setInterval(tick, 1000);
          return () => window.clearInterval(id.current);
        }, []);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a literal init hidden behind unrelated ref bookkeeping", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const trackRef = useRef(false);
        const [count, setCount] = useState(0);
        useEffect(() => {
          setCount(42);
          trackRef.current = true;
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a literal init inside a bare typeof-window SSR guard", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [ready, setReady] = useState(false);
        useEffect(() => {
          if (typeof window !== 'undefined') setReady(true);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a setter fed from a localStorage read via a local variable", () => {
    const result = runRule(
      noInitializeState,
      `function Theme() {
        const [theme, setTheme] = useState("light");
        useEffect(() => {
          const saved = localStorage.getItem("theme");
          setTheme(saved ?? "light");
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a stored callback whose body reads Date.now (deterministic value)", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [callback, setCallback] = useState(null);
        useEffect(() => {
          setCallback(() => Date.now());
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a setter argument whose member property merely shadows a global name", () => {
    const result = runRule(
      noInitializeState,
      `function C({ data }) {
        const [doc, setDoc] = useState(null);
        useEffect(() => {
          setDoc(data.document);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the setter argument is a ref DOM measurement", () => {
    const result = runRule(
      noInitializeState,
      `function ScrollView() {
        const viewportRef = useRef(null);
        const [showThumb, setShowThumb] = useState(false);
        useEffect(() => {
          if (viewportRef.current) setShowThumb(viewportRef.current.scrollHeight > 0);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the setter argument derives from matchMedia via a local", () => {
    const result = runRule(
      noInitializeState,
      `function Mode() {
        const [mode, setMode] = useState("system");
        useEffect(() => {
          const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
          setMode(mediaQuery.matches ? "dark" : "light");
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
