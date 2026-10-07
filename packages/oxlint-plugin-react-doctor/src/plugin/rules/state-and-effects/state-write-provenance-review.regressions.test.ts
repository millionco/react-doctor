import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

const expectDiagnosticCount = (
  rule: typeof noAdjustStateOnPropChange,
  code: string,
  diagnosticCount: number,
): void => {
  const result = runRule(rule, code, { forceJsx: true });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(diagnosticCount);
};

describe("state write provenance review regressions", () => {
  it("reports a prop-keyed reset alongside unrelated subscription work", () => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `function Editor({ documentId, source }) {
        const [draft, setDraft] = useState(null);
        useEffect(() => {
          source.subscribe(() => source.refresh());
          setDraft(null);
        }, [documentId, source]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      }`,
      1,
    );
  });

  it("reports a single-prop reset alongside unrelated root subscription work", () => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `function Editor({ documentId }) {
        const [draft, setDraft] = useState(null);
        useEffect(() => {
          analytics.subscribe(recordView);
          setDraft(null);
        }, [documentId]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      }`,
      1,
    );
  });

  it("reports unrelated subscription work and a reset inside an invoked useCallback", () => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useState } from "react";
      function Editor({ documentId }) {
        const [draft, setDraft] = useState(null);
        const resetDraft = useCallback(() => {
          analytics.subscribe(recordView);
          setDraft(null);
        }, []);
        useEffect(() => {
          resetDraft();
        }, [documentId, resetDraft]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      }`,
      1,
    );
  });

  it.each([
    [
      "same conditional branch",
      `useEffect(() => {
        if (documentId) {
          analytics.subscribe(recordView);
          setDraft(null);
        }
      }, [documentId]);`,
    ],
    [
      "helper invoked from a conditional",
      `const resetDraft = useCallback(() => {
        analytics.subscribe(recordView);
        setDraft(null);
      }, []);
      useEffect(() => {
        if (documentId) resetDraft();
      }, [documentId, resetDraft]);`,
    ],
  ])("reports unrelated external work in the %s", (_, effectSource) => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useState } from "react";
      function Editor({ documentId }) {
        const [draft, setDraft] = useState(null);
        ${effectSource}
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      }`,
      1,
    );
  });

  it.each([
    [
      "a nested callback read",
      `if (disabled && check(() => playing)) {
        clearTimeout(timer.current);
        setPlaying(false);
      }`,
    ],
    [
      "a statically unreachable read",
      `if (disabled || (false && playing)) {
        clearTimeout(timer.current);
        setPlaying(false);
      }`,
    ],
  ])("does not use %s as state control provenance", (_, guardedWork) => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `function Slideshow({ disabled }) {
        const [playing, setPlaying] = useState(true);
        const timer = useRef();
        useEffect(() => {
          ${guardedWork}
        }, [playing, disabled]);
        return playing;
      }`,
      1,
    );
  });

  it.each([
    [
      "timer cleanup guarded by its state",
      `useEffect(() => {
        if (playing && disabled) {
          clearTimeout(timer.current);
          setPlaying(false);
        }
      }, [playing, disabled]);`,
    ],
    [
      "external helper invocation guarded by its state",
      `const stopSession = useCallback(() => {
        fetch("/session/stop");
        setPlaying(false);
      }, []);
      useEffect(() => {
        if (playing && disabled) stopSession();
      }, [playing, disabled, stopSession]);`,
    ],
  ])("keeps genuinely related %s quiet", (_, effectSource) => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useState } from "react";
      function Session({ disabled }) {
        const [playing, setPlaying] = useState(true);
        const timer = useRef();
        ${effectSource}
        return playing;
      }`,
      0,
    );
  });

  it("does not treat a shadowed timer cleanup name as external work", () => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `const clearTimeout = () => recordCleanup();
      function Editor({ documentId }) {
        const [draft, setDraft] = useState(null);
        useEffect(() => {
          clearTimeout();
          setDraft(null);
        }, [documentId]);
        return draft;
      }`,
      1,
    );
  });

  it.each([
    ["a global cleanup alias", "const stopTimer = clearTimeout;", "stopTimer(timer.current);"],
    ["a window cleanup member", "", "window.clearTimeout(timer.current);"],
  ])("preserves timer ownership through %s", (_, declaration, cleanup) => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `${declaration}
      function Slideshow({ disabled }) {
        const [playing, setPlaying] = useState(true);
        const timer = useRef();
        useEffect(() => {
          if (playing && disabled) {
            ${cleanup}
            setPlaying(false);
          }
        }, [playing, disabled]);
        return playing;
      }`,
      0,
    );
  });

  it("follows nested fetch work through a genuine useCallback", () => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useState } from "react";
      function Session({ disabled }) {
        const [active, setActive] = useState(true);
        const stopSession = useCallback(() => {
          fetch("/session/stop");
        }, []);
        useEffect(() => {
          if (active && disabled) {
            stopSession();
            setActive(false);
          }
        }, [active, disabled, stopSession]);
        return active;
      }`,
      0,
    );
  });

  it("keeps each helper invocation path distinct when relating external work", () => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useState } from "react";
      function Session({ disabled }) {
        const [active, setActive] = useState(true);
        const stopSession = useCallback(() => {
          fetch("/session/stop");
        }, []);
        useEffect(() => {
          if (active && disabled) {
            stopSession();
            setActive(false);
          }
          stopSession();
        }, [active, disabled, stopSession]);
        return active;
      }`,
      0,
    );
  });

  it("does not treat an unrelated state read as a write guard", () => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `function Input({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => {
          logValue(draft);
          setDraft(value);
        }, [value]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      }`,
      0,
    );
  });

  it("recognizes the current state parameter in a functional updater", () => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `function DocumentHistoryModal({ versions }) {
        const visibleVersions = useMemo(
          () => versions.filter((version) => version.visible),
          [versions],
        );
        const [selectedVersionId, setSelectedVersionId] = useState("");
        useEffect(() => {
          setSelectedVersionId((currentVersionId) =>
            visibleVersions.some((version) => version.versionId === currentVersionId)
              ? currentVersionId
              : visibleVersions[0].versionId,
          );
        }, [visibleVersions]);
        return (
          <VersionList
            versions={visibleVersions}
            selectedVersionId={selectedVersionId}
            onSelect={setSelectedVersionId}
          />
        );
      }`,
      1,
    );
  });

  it.each([
    [
      "a genuine useCallback",
      `const selectFirstVersion = useCallback(
        (versionId) => setSelectedVersionId(versionId),
        [],
      );`,
      "selectFirstVersion(visibleVersions[0].versionId);",
    ],
    ["an IIFE", "", "(() => setSelectedVersionId(visibleVersions[0].versionId))();"],
  ])("carries an AppFlowy state guard through %s", (_, helper, write) => {
    expectDiagnosticCount(
      noAdjustStateOnPropChange,
      `import { useCallback, useEffect, useMemo, useState } from "react";
      function DocumentHistoryModal({ versions }) {
        const visibleVersions = useMemo(
          () => versions.filter((version) => version.visible),
          [versions],
        );
        const [selectedVersionId, setSelectedVersionId] = useState("");
        ${helper}
        useEffect(() => {
          if (visibleVersions.some((version) => version.versionId === selectedVersionId)) {
            return;
          }
          ${write}
        }, [visibleVersions]);
        return (
          <VersionList
            versions={visibleVersions}
            selectedVersionId={selectedVersionId}
            onSelect={setSelectedVersionId}
          />
        );
      }`,
      1,
    );
  });

  it("does not accept an unreachable handler-looking function as an independent writer", () => {
    expectDiagnosticCount(
      noDerivedStateEffect,
      `function Input({ value }) {
        const [draft, setDraft] = useState(value);
        const handleDraftChange = (nextValue) => setDraft(nextValue);
        useEffect(() => {
          setDraft(value);
        }, [value]);
        return <output>{draft}</output>;
      }`,
      1,
    );
  });

  it("ignores helper parameters used only by dead local provenance", () => {
    expectDiagnosticCount(
      noDerivedStateEffect,
      `const deriveRows = (items) => {
        const ignoredItems = items;
        return [];
      };
      function List({ items }) {
        const [rows, setRows] = useState([]);
        useEffect(() => {
          setRows(deriveRows(items));
        }, [items]);
        return <ListView rows={rows} />;
      }`,
      0,
    );
  });

  it("keeps returned local helper provenance", () => {
    expectDiagnosticCount(
      noDerivedStateEffect,
      `const deriveRows = (items) => {
        const rows = items.map((item) => item.label);
        return rows;
      };
      function List({ items }) {
        const [rows, setRows] = useState([]);
        useEffect(() => {
          setRows(deriveRows(items));
        }, [items]);
        return <ListView rows={rows} />;
      }`,
      1,
    );
  });

  it("does not classify zero-argument Date reads as deterministic derivation", () => {
    expectDiagnosticCount(
      noDerivedStateEffect,
      `const sortRows = (items) =>
        [...items].sort(() => new Date().getTime());
      function List({ items }) {
        const [rows, setRows] = useState([]);
        useEffect(() => {
          setRows(sortRows(items));
        }, [items]);
        return <ListView rows={rows} />;
      }`,
      0,
    );
  });
});
