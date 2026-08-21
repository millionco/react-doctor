import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noDerivedState } from "./no-derived-state.js";

const rules = [noDerivedStateEffect, noDerivedState];

const expectDiagnosticCount = (code: string, diagnosticCount: number): void => {
  for (const rule of rules) {
    const result = runRule(rule, code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  }
};

describe("derived-state AppFlowy selection repair", () => {
  it.each(["visibleVersions", "(visibleVersions as any)", "visibleVersions!"])(
    "reports the authentic render-known collection membership repair through %s",
    (membershipReceiver) => {
      expectDiagnosticCount(
        `import { useEffect, useMemo, useState } from "react";
      function DocumentHistoryModal({ initialVersions }) {
        const [versions, setVersions] = useState(initialVersions);
        const [selectedVersionId, setSelectedVersionId] = useState("");
        const [onlyShowMine, setOnlyShowMine] = useState(false);
        const visibleVersions = useMemo(() => {
          let filtered = [...versions];
          if (onlyShowMine) {
            filtered = filtered.filter((version) => version.isMine);
          }
          return filtered;
        }, [versions, onlyShowMine]);
        useEffect(() => {
          if (visibleVersions.length === 0) {
            if (selectedVersionId) {
              setSelectedVersionId("");
            }
            return;
          }
          if (!${membershipReceiver}.some((version) => version.versionId === selectedVersionId)) {
            setSelectedVersionId(visibleVersions[0].versionId);
          }
        }, [visibleVersions, selectedVersionId]);
        return (
          <VersionList
            versions={visibleVersions}
            selectedVersionId={selectedVersionId}
            onSelect={setSelectedVersionId}
            onVersionsChange={setVersions}
            onOnlyShowMineChange={setOnlyShowMine}
          />
        );
      }`,
        1,
      );
    },
  );

  it("reports a state-backed selection repair expressed as a functional updater", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          setSelectedId((currentSelectedId) =>
            entries.some((entry) => entry.id === currentSelectedId)
              ? currentSelectedId
              : entries[0].id,
          );
        }, [entries]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      1,
    );
  });

  it("does not report a functional selection updater with an opaque conditional return", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries, resolveSelection }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          setSelectedId((currentSelectedId) =>
            currentSelectedId ? resolveSelection() : entries[0].id,
          );
        }, [entries, resolveSelection]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not report a functional selection updater that reads different collections", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries, initialFallbacks }) {
        const [entries] = useState(initialEntries);
        const [fallbacks] = useState(initialFallbacks);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          setSelectedId((currentSelectedId) =>
            currentSelectedId ? fallbacks[0].id : entries[0].id,
          );
        }, [entries, fallbacks]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not report a block updater with an opaque reachable return", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries, resolveSelection }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          setSelectedId((currentSelectedId) => {
            if (!currentSelectedId) return entries[0].id;
            return resolveSelection();
          });
        }, [entries, resolveSelection]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not report an indexed collection value appended by a functional updater", () => {
    expectDiagnosticCount(
      `function EntryHistory({ initialEntries }) {
        const [entries] = useState(initialEntries);
        const [visitedIds, setVisitedIds] = useState([]);
        useEffect(() => {
          setVisitedIds((currentVisitedIds) => [...currentVisitedIds, entries[0].id]);
        }, [entries]);
        return (
          <EntryHistoryList
            entries={entries}
            visitedIds={visitedIds}
            onClear={() => setVisitedIds([])}
          />
        );
      }`,
      0,
    );
  });

  it("leaves a prop-backed functional selection repair to the prop-adjustment rule", () => {
    expectDiagnosticCount(
      `function EntryList({ entries }) {
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          setSelectedId((currentSelectedId) =>
            entries.some((entry) => entry.id === currentSelectedId)
              ? currentSelectedId
              : entries[0].id,
          );
        }, [entries]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not report an event-owned scalar mirror", () => {
    expectDiagnosticCount(
      `function Editor({ settings }) {
        const [theme, setTheme] = useState(settings.theme);
        useEffect(() => {
          if (theme !== settings.theme) {
            setTheme(settings.theme);
          }
        }, [settings, theme]);
        return <ThemePicker value={theme} onChange={setTheme} />;
      }`,
      0,
    );
  });

  it("does not report an indexed write without a current-selection guard", () => {
    expectDiagnosticCount(
      `function Editor({ entries }) {
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          logSelection(selectedId);
          setSelectedId(entries[0].id);
        }, [entries]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not treat a state read captured by an opaque guard callback as selection repair", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries, shouldRepair }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          if (shouldRepair(() => selectedId)) {
            setSelectedId(entries[0].id);
          }
        }, [entries, shouldRepair]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not trust a custom deferred .some callback as an immediate selection guard", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        const customCollection = {
          some: (callback) => {
            queueMicrotask(callback);
            return true;
          },
        };
        useEffect(() => {
          if (customCollection.some(() => selectedId)) {
            setSelectedId(entries[0].id);
          }
        }, [entries]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("still reports an indexed selection repair guarded by an immediate IIFE read", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          if ((() => selectedId)()) {
            setSelectedId(entries[0].id);
          }
        }, [entries, selectedId]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      1,
    );
  });

  it("does not treat a state read after await in an async IIFE as an immediate guard", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          if ((async () => {
            await Promise.resolve();
            return selectedId;
          })()) {
            setSelectedId(entries[0].id);
          }
        }, [entries, selectedId]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not execute a generator IIFE body while classifying a selection guard", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          if ((function* () {
            return selectedId;
          })()) {
            setSelectedId(entries[0].id);
          }
        }, [entries, selectedId]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not treat a state read after await in an async array callback as immediate", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          if ([1].some(async () => {
            await Promise.resolve();
            return selectedId;
          })) {
            setSelectedId(entries[0].id);
          }
        }, [entries, selectedId]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not treat an unreachable empty-array callback read as a selection guard", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          if ([].some(() => selectedId)) {
            setSelectedId(entries[0].id);
          }
        }, [entries, selectedId]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not trust a custom memoized .map result as an array selection guard", () => {
    expectDiagnosticCount(
      `function EntryList({ initialSource }) {
        const [customSource] = useState(initialSource);
        const [selectedId, setSelectedId] = useState("");
        const visibleEntries = useMemo(
          () => customSource.map((entry) => entry),
          [customSource],
        );
        useEffect(() => {
          if (visibleEntries.some(() => selectedId)) {
            setSelectedId(visibleEntries[0].id);
          }
        }, [visibleEntries, selectedId]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not trust an overridden array .map result as an immediate selection guard", () => {
    expectDiagnosticCount(
      `function EntryList() {
        const source = [1];
        const sourceAlias = source;
        sourceAlias.map = () => ({
          some: (callback) => {
            queueMicrotask(callback);
            return true;
          },
        });
        const [selectedId, setSelectedId] = useState("");
        const values = useMemo(() => source.map((value) => value), []);
        useEffect(() => {
          if (values.some(() => selectedId)) {
            setSelectedId(values[0].id);
          }
        }, [values, selectedId]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("does not trust a state object's custom .filter result as a selection guard", () => {
    expectDiagnosticCount(
      `function EntryList() {
        const [source] = useState({
          filter: () => ({
            0: { id: "fallback" },
            some: (callback) => {
              queueMicrotask(callback);
              return true;
            },
          }),
        });
        const [selectedId, setSelectedId] = useState("");
        const values = useMemo(() => source.filter((value) => value), [source]);
        useEffect(() => {
          if (values.some(() => selectedId)) {
            setSelectedId(values[0].id);
          }
        }, [values, selectedId]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });

  it("still reports a selection repair through a state-backed memoized array alias", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        const memoizedEntries = useMemo(() => [...entries], [entries]);
        const visibleEntries = memoizedEntries;
        useEffect(() => {
          if (visibleEntries.some(() => selectedId)) {
            setSelectedId(visibleEntries[0].id);
          }
        }, [visibleEntries, selectedId]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      1,
    );
  });

  it("still reports an indexed selection repair guarded by inline array .some", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          if ([...entries].some(() => selectedId)) {
            setSelectedId(entries[0].id);
          }
        }, [entries, selectedId]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      1,
    );
  });

  it("still reports an indexed selection repair controlled by an immediate state read", () => {
    expectDiagnosticCount(
      `function EntryList({ initialEntries }) {
        const [entries] = useState(initialEntries);
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          if (!selectedId && entries.length > 0) {
            setSelectedId(entries[0].id);
          }
        }, [entries, selectedId]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      1,
    );
  });

  it("leaves prop-derived selection repair to the prop-adjustment rule", () => {
    expectDiagnosticCount(
      `function VersionList({ versions }) {
        const [selectedId, setSelectedId] = useState("");
        useEffect(() => {
          if (!versions.some((version) => version.id === selectedId)) {
            setSelectedId(versions[0].id);
          }
        }, [versions]);
        return <EntryPicker value={selectedId} onChange={setSelectedId} />;
      }`,
      0,
    );
  });
});
