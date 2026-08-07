import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("no-adjust-state-on-prop-change — Slideshow terminal transitions", () => {
  it("stays silent when a disabled finite slideshow cancels its timer before stopping", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import * as React from "react";
      import { useTimeouts } from "../../index.js";
      function Slideshow({ disabled }) {
        const [playing, setPlaying] = React.useState(true);
        const { setTimeout, clearTimeout } = useTimeouts();
        const scheduler = React.useRef();
        const cancelScheduler = React.useCallback(() => {
          clearTimeout(scheduler.current);
          scheduler.current = undefined;
        }, [clearTimeout]);
        React.useEffect(() => {
          if (disabled) {
            cancelScheduler();
            if (playing) {
              setPlaying(false);
            }
          } else if (playing) {
            scheduler.current = setTimeout(advance, 1000);
          }
        }, [playing, disabled, cancelScheduler, setTimeout]);
        return playing;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a nested state adjustment when timer scheduling precedes it", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Slideshow({ disabled }) {
        const [playing, setPlaying] = useState(true);
        useEffect(() => {
          if (disabled) {
            setTimeout(advance, 1000);
            if (playing) {
              setPlaying(false);
            }
          }
        }, [playing, disabled]);
        return playing;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a nested state adjustment when timer cancellation follows it", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Slideshow({ disabled }) {
        const [playing, setPlaying] = useState(true);
        const scheduler = useRef();
        useEffect(() => {
          if (disabled) {
            if (playing) {
              setPlaying(false);
            }
            clearTimeout(scheduler.current);
          }
        }, [playing, disabled]);
        return playing;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["direct transition", "cancelScheduler(); setPlaying(false);"],
    ["stable callback transition", "pause();"],
    ["inline transition", "(() => { cancelScheduler(); setPlaying(false); })();"],
  ])("stays silent for finite timer ownership through a %s", (_, transition) => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import * as React from "react";
      import { useTimeouts } from "../../index.js";
      function Slideshow({ disabled }) {
        const [playing, setPlaying] = React.useState(true);
        const { setTimeout, clearTimeout } = useTimeouts();
        const scheduler = React.useRef();
        const cancelScheduler = React.useCallback(() => {
          clearTimeout(scheduler.current);
          scheduler.current = undefined;
        }, []);
        const pause = React.useCallback(() => {
          cancelScheduler();
          setPlaying(false);
        }, [cancelScheduler]);
        React.useEffect(() => {
          if (playing && disabled) {
            ${transition}
          }
        }, [playing, disabled, cancelScheduler, pause]);
        return playing;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports a bare prop-keyed draft reset", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Editor({ documentId }) {
        const [draft, setDraft] = useState(null);
        useEffect(() => {
          setDraft(null);
        }, [documentId]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a userland callback wrapper as timer ownership", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Selection({ itemId, useCallback }) {
        const [selection, setSelection] = useState(null);
        const scheduler = useRef();
        const cancelScheduler = useCallback(() => {
          clearTimeout(scheduler.current);
        }, []);
        useEffect(() => {
          cancelScheduler();
          setSelection(null);
        }, [itemId, cancelScheduler]);
        return selection;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "an unrelated imported hook",
      `import { useScheduler } from "./scheduler";
      const { setTimeout, clearTimeout } = useScheduler();`,
    ],
    [
      "a local hook with the same name",
      `const useTimeouts = () => ({ setTimeout, clearTimeout });
      const { setTimeout: schedule, clearTimeout } = useTimeouts();`,
    ],
    [
      "an unpaired timeout cleanup",
      `import { useTimeouts } from "./timeouts";
      const { clearTimeout } = useTimeouts();`,
    ],
  ])("does not infer timer ownership from %s", (_, timerSetup) => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import * as React from "react";
      ${timerSetup}
      function Slideshow({ disabled }) {
        const [playing, setPlaying] = React.useState(true);
        const scheduler = React.useRef();
        const cancelScheduler = React.useCallback(() => {
          clearTimeout(scheduler.current);
        }, [clearTimeout]);
        React.useEffect(() => {
          if (playing && disabled) {
            cancelScheduler();
            setPlaying(false);
          }
        }, [playing, disabled, cancelScheduler]);
        return playing;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a prop-derived invalid-selection repair", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const visibleVersions = useMemo(
          () => [...versions].filter((version) => version.visible),
          [versions],
        );
        const [selectedVersionId, setSelectedVersionId] = useState("");
        useEffect(() => {
          if (!visibleVersions.some((version) => version.versionId === selectedVersionId)) {
            setSelectedVersionId(visibleVersions[0].versionId);
          }
        }, [visibleVersions]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a state read captured by an opaque guard callback as prop adjustment", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions, shouldRepair }) {
        const [selectedVersionId, setSelectedVersionId] = useState("");
        useEffect(() => {
          if (shouldRepair(() => selectedVersionId)) {
            setSelectedVersionId(versions[0].versionId);
          }
        }, [versions, shouldRepair]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust a custom deferred .some callback as immediate prop adjustment", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const [selectedVersionId, setSelectedVersionId] = useState("");
        const customCollection = {
          some: (callback) => {
            queueMicrotask(callback);
            return true;
          },
        };
        useEffect(() => {
          if (customCollection.some(() => selectedVersionId)) {
            setSelectedVersionId(versions[0].versionId);
          }
        }, [versions]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports prop adjustment guarded by an immediate IIFE state read", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const [selectedVersionId, setSelectedVersionId] = useState("");
        useEffect(() => {
          if ((() => selectedVersionId)()) {
            setSelectedVersionId(versions[0].versionId);
          }
        }, [versions, selectedVersionId]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a state read after await in an async IIFE as immediate prop adjustment", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const [selectedVersionId, setSelectedVersionId] = useState("");
        useEffect(() => {
          if ((async () => {
            await Promise.resolve();
            return selectedVersionId;
          })()) {
            setSelectedVersionId(versions[0].versionId);
          }
        }, [versions, selectedVersionId]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not execute a generator IIFE body while classifying prop adjustment", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const [selectedVersionId, setSelectedVersionId] = useState("");
        useEffect(() => {
          if ((function* () {
            return selectedVersionId;
          })()) {
            setSelectedVersionId(versions[0].versionId);
          }
        }, [versions, selectedVersionId]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a state read after await in an async array callback as immediate", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const [selectedVersionId, setSelectedVersionId] = useState("");
        useEffect(() => {
          if ([1].some(async () => {
            await Promise.resolve();
            return selectedVersionId;
          })) {
            setSelectedVersionId(versions[0].versionId);
          }
        }, [versions, selectedVersionId]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat an unreachable empty-array callback read as immediate prop adjustment", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const [selectedVersionId, setSelectedVersionId] = useState("");
        useEffect(() => {
          if ([].some(() => selectedVersionId)) {
            setSelectedVersionId(versions[0].versionId);
          }
        }, [versions, selectedVersionId]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust a custom memoized .map result as immediate prop adjustment", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ customSource }) {
        const [selectedVersionId, setSelectedVersionId] = useState("");
        const visibleVersions = useMemo(
          () => customSource.map((version) => version),
          [customSource],
        );
        useEffect(() => {
          if (visibleVersions.some(() => selectedVersionId)) {
            setSelectedVersionId(visibleVersions[0].versionId);
          }
        }, [visibleVersions, selectedVersionId]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust an overridden array .map result as immediate prop adjustment", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const source = [1];
        source.map = () => ({
          some: (callback) => {
            queueMicrotask(callback);
            return true;
          },
        });
        const [selectedVersionId, setSelectedVersionId] = useState("");
        const values = useMemo(() => source.map((value) => value), []);
        useEffect(() => {
          if (values.some(() => selectedVersionId)) {
            setSelectedVersionId(versions[0].versionId);
          }
        }, [versions, values, selectedVersionId]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust a state object's custom .filter result as immediate prop adjustment", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const [source] = useState({
          filter: () => ({
            0: { versionId: "fallback" },
            some: (callback) => {
              queueMicrotask(callback);
              return true;
            },
          }),
        });
        const [selectedVersionId, setSelectedVersionId] = useState("");
        const values = useMemo(() => source.filter((value) => value), [source]);
        useEffect(() => {
          if (values.some(() => selectedVersionId)) {
            setSelectedVersionId(versions[0].versionId);
          }
        }, [versions, values, selectedVersionId]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports prop adjustment through a memoized prop-array alias", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const [selectedVersionId, setSelectedVersionId] = useState("");
        const memoizedVersions = useMemo(() => [...versions], [versions]);
        const visibleVersions = memoizedVersions;
        useEffect(() => {
          if (visibleVersions.some(() => selectedVersionId)) {
            setSelectedVersionId(visibleVersions[0].versionId);
          }
        }, [visibleVersions, selectedVersionId]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports prop adjustment guarded by inline array .some", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const [selectedVersionId, setSelectedVersionId] = useState("");
        useEffect(() => {
          if ([...versions].some(() => selectedVersionId)) {
            setSelectedVersionId(versions[0].versionId);
          }
        }, [versions, selectedVersionId]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports prop adjustment controlled by an immediate state read", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function VersionList({ versions }) {
        const [selectedVersionId, setSelectedVersionId] = useState("");
        useEffect(() => {
          if (!selectedVersionId && versions.length > 0) {
            setSelectedVersionId(versions[0].versionId);
          }
        }, [versions, selectedVersionId]);
        return <List selected={selectedVersionId} onSelect={setSelectedVersionId} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
