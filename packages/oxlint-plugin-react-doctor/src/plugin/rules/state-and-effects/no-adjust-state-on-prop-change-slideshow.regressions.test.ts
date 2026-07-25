import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("no-adjust-state-on-prop-change — Slideshow terminal transitions", () => {
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
          () => versions.filter((version) => version.visible),
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
});
