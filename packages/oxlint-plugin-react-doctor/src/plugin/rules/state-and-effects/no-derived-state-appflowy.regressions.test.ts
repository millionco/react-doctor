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
  it("reports the authentic render-known collection membership repair", () => {
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
          if (!visibleVersions.some((version) => version.versionId === selectedVersionId)) {
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
