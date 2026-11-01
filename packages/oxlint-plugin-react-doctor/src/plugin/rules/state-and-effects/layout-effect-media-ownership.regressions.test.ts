import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

describe("layout media ref ownership", () => {
  it.each([
    [
      "unused JSX",
      `const unusedVideo = <video ref={mediaRef} src={source} />; return <div>{failed}</div>;`,
    ],
    [
      "uncalled renderer",
      `const renderVideo = () => <video ref={mediaRef} src={source} />; return <div>{failed}</div>;`,
    ],
    ["opaque JSX property", `return <Wrapper media={<video ref={mediaRef} src={source} />} />;`],
  ])("does not use %s as a proven mounted receiver", (_name, output) => {
    const code = `import { useLayoutEffect, useRef, useState } from "react";
      const Example = ({ source }) => {
        const mediaRef = useRef(null);
        const [failed, setFailed] = useState(false);
        useLayoutEffect(() => setFailed(false), [source]);
        useLayoutEffect(() => {
          const player = mediaRef.current;
          if (player) player.play().catch(() => setFailed(true));
        }, [source]);
        ${output}
      };`;
    for (const rule of [noAdjustStateOnPropChange, noResetAllStateOnPropChange]) {
      const result = runRule(rule, code, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([
    ["direct JSX", `return <video ref={mediaRef} src={source} hidden={failed} />;`],
    [
      "an intrinsic child",
      `return <div><video ref={mediaRef} src={source} hidden={failed} /></div>;`,
    ],
    [
      "a returned const alias",
      `const media = <video ref={mediaRef} src={source} hidden={failed} />; return media;`,
    ],
    [
      "conditional JSX",
      `return source ? <video ref={mediaRef} src={source} hidden={failed} /> : null;`,
    ],
  ])("preserves %s as a mounted receiver", (_name, output) => {
    const code = `import { useLayoutEffect, useRef, useState } from "react";
      const Example = ({ source }) => {
        const mediaRef = useRef(null);
        const [failed, setFailed] = useState(false);
        useLayoutEffect(() => setFailed(false), [source]);
        useLayoutEffect(() => {
          const player = mediaRef.current;
          if (player) player.play().catch(() => setFailed(true));
        }, [source]);
        ${output}
      };`;
    for (const rule of [noAdjustStateOnPropChange, noResetAllStateOnPropChange]) {
      const result = runRule(rule, code, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });
});

describe.each([noAdjustStateOnPropChange, noResetAllStateOnPropChange])(
  "$id playback execution ownership",
  (rule) => {
    it.each([
      ["unused", "", 1],
      ["invoked", "play();", 0],
    ])("handles an %s playback helper", (_name, invocation, expectedCount) => {
      const result = runRule(
        rule,
        `import { useLayoutEffect, useRef, useState } from "react";
          const Example = ({ source }) => {
            const mediaRef = useRef(null);
            const [failed, setFailed] = useState(false);
            useLayoutEffect(() => setFailed(false), [source]);
            useLayoutEffect(() => {
              const play = () => {
                const player = mediaRef.current;
                if (player) player.play().catch(() => setFailed(true));
              };
              ${invocation}
            }, [source]);
            return <video ref={mediaRef} src={source} hidden={failed} />;
          };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expectedCount);
    });
  },
);
