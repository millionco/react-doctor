import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noDerivedState } from "./no-derived-state.js";

const expectDiagnosticCount = (
  rule: typeof noDerivedState,
  code: string,
  diagnosticCount: number,
): void => {
  const result = runRule(rule, code, { forceJsx: true });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(diagnosticCount);
};

describe("derived-state helper provenance", () => {
  it.each([
    [
      "slice copy",
      `function sortApiKeys(apiKeys) {
        return apiKeys.slice().sort((firstApiKey, secondApiKey) => {
          const createdAtDifference =
            new Date(secondApiKey.createdAt).getTime() -
            new Date(firstApiKey.createdAt).getTime();
          if (createdAtDifference !== 0) return createdAtDifference;
          return firstApiKey.id < secondApiKey.id
            ? -1
            : firstApiKey.id > secondApiKey.id
              ? 1
              : 0;
        });
      }`,
    ],
    [
      "spread copy",
      `function sortApiKeys(apiKeys) {
        return [...apiKeys].sort((firstApiKey, secondApiKey) => {
          const createdAtDifference =
            new Date(secondApiKey.createdAt).getTime() -
            new Date(firstApiKey.createdAt).getTime();
          if (createdAtDifference !== 0) return createdAtDifference;
          return firstApiKey.id < secondApiKey.id
            ? -1
            : firstApiKey.id > secondApiKey.id
              ? 1
              : 0;
        });
      }`,
    ],
  ])("reports the authentic mailing settings %s helper", (_scenario, helperSource) => {
    const code = `${helperSource}
      function Settings({ initialApiKeys }) {
        const [apiKeys, setApiKeys] = useState(initialApiKeys);
        const [apiKeyRows, setApiKeyRows] = useState([]);
        const createApiKey = useCallback(async () => {
          const response = await fetch("/api/apiKeys");
          setApiKeys(await response.json());
        }, []);
        useEffect(() => {
          setApiKeyRows(
            sortApiKeys(apiKeys).map((apiKey) => [
              apiKey.id,
              String(apiKey.active),
              new Date(apiKey.createdAt).toLocaleString("en-US", { timeZone: "UTC" }),
            ]),
          );
        }, [apiKeys]);
        return <button onClick={createApiKey}>{apiKeyRows.length}</button>;
      }`;

    expectDiagnosticCount(noDerivedState, code, 1);
    expectDiagnosticCount(noDerivedStateEffect, code, 1);
  });

  it.each([
    [
      "an external comparator",
      `const sortApiKeys = (apiKeys) =>
        [...apiKeys].sort((firstApiKey, secondApiKey) =>
          compareApiKeys(firstApiKey, secondApiKey),
        );`,
    ],
    [
      "a shadowed Date constructor",
      `const Date = class {
        constructor(value) {
          trackDateConstruction(value);
        }
        getTime() {
          return readClock();
        }
      };
      const sortApiKeys = (apiKeys) =>
        [...apiKeys].sort(
          (firstApiKey, secondApiKey) =>
            new Date(secondApiKey.createdAt).getTime() -
            new Date(firstApiKey.createdAt).getTime(),
        );`,
    ],
  ])("keeps copy-first sort unknown with %s", (_scenario, helperSource) => {
    expectDiagnosticCount(
      noDerivedStateEffect,
      `${helperSource}
      function Settings({ apiKeys }) {
        const [apiKeyRows, setApiKeyRows] = useState([]);
        useEffect(() => {
          setApiKeyRows(sortApiKeys(apiKeys));
        }, [apiKeys]);
        return <output>{apiKeyRows.length}</output>;
      }`,
      0,
    );
  });

  it.each([
    [
      "a local setter helper",
      `const writeRows = (nextItems) => setRows(nextItems.map((item) => item.label));
       useEffect(() => writeRows(items), [items]);`,
    ],
    [
      "an immutable helper alias",
      `const writeRows = (nextItems) => setRows(nextItems.map((item) => item.label));
       const commitRows = writeRows;
       useEffect(() => commitRows(items), [items]);`,
    ],
    [
      "a synchronous IIFE",
      `useEffect(() => {
         (() => setRows(items.map((item) => item.label)))();
       }, [items]);`,
    ],
    [
      "a synchronous iterator callback",
      `useEffect(() => {
         [items].forEach((nextItems) => setRows(nextItems.map((item) => item.label)));
       }, [items]);`,
    ],
  ])("reports derivation delegated through %s", (_scenario, effectSource) => {
    expectDiagnosticCount(
      noDerivedStateEffect,
      `function List({ items }) {
        const [rows, setRows] = useState([]);
        ${effectSource}
        return <ListView rows={rows} />;
      }`,
      1,
    );
  });

  it("keeps event-owned helper state quiet", () => {
    const code = `function Input({ value }) {
      const [draft, setDraft] = useState(value);
      const updateDraft = useCallback((nextValue) => setDraft(nextValue), []);
      const onChange = useCallback(
        (event) => updateDraft(event.target.value),
        [updateDraft],
      );
      useEffect(() => updateDraft(value), [updateDraft, value]);
      return <input value={draft} onChange={onChange} />;
    }`;

    expectDiagnosticCount(noDerivedState, code, 0);
    expectDiagnosticCount(noDerivedStateEffect, code, 0);
    expectDiagnosticCount(noAdjustStateOnPropChange, code, 0);
  });

  it("reports AppFlowy's effect-driven invalid-selection fallback", () => {
    const code = `function DocumentHistoryModal({ versions }) {
      const visibleVersions = useMemo(
        () => versions.filter((version) => version.visible),
        [versions],
      );
      const [selectedVersionId, setSelectedVersionId] = useState("");
      useEffect(() => {
        if (visibleVersions.some((version) => version.versionId === selectedVersionId)) {
          return;
        }
        setSelectedVersionId(visibleVersions[0].versionId);
      }, [visibleVersions]);
      return (
        <VersionList
          versions={visibleVersions}
          selectedVersionId={selectedVersionId}
          onSelect={setSelectedVersionId}
        />
      );
    }`;

    expectDiagnosticCount(noDerivedState, code, 0);
    expectDiagnosticCount(noDerivedStateEffect, code, 0);
    expectDiagnosticCount(noAdjustStateOnPropChange, code, 1);
  });

  it("keeps post-await and DOM-derived synchronization quiet", () => {
    const code = `function Measurements({ source, targetRef }) {
      const [remoteRows, setRemoteRows] = useState([]);
      const [rect, setRect] = useState(null);
      useEffect(() => {
        void (async () => {
          await source.ready();
          setRemoteRows(source.read());
        })();
      }, [source]);
      useLayoutEffect(() => {
        setRect(targetRef.current.getBoundingClientRect());
      }, [targetRef]);
      return <Output rect={rect} rows={remoteRows} />;
    }`;

    expectDiagnosticCount(noDerivedState, code, 0);
    expectDiagnosticCount(noDerivedStateEffect, code, 0);
    expectDiagnosticCount(noAdjustStateOnPropChange, code, 0);
  });

  it.each([
    [
      "an IIFE",
      `(() => {
        source.subscribe(refresh);
      })();`,
    ],
    [
      "a synchronous iterator callback",
      `[source].forEach((currentSource) => {
        currentSource.subscribe(refresh);
      });`,
    ],
    [
      "an aliased synchronous iterator callback",
      `const subscribe = (currentSource) => currentSource.subscribe(refresh);
       const subscribeAlias = subscribe;
       [source].map(subscribeAlias);`,
    ],
  ])("keeps state resets beside external work in %s quiet", (_scenario, externalWork) => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `function Feed({ source }) {
        const [selection, setSelection] = useState(null);
        useEffect(() => {
          setSelection(null);
          ${externalWork}
        }, [source]);
        return <output>{selection}</output>;
      }`,
      0,
    );
  });
});
