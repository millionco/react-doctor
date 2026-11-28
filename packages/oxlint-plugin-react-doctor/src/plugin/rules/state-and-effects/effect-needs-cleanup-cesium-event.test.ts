import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const buildSource = ({
  constructorImport = 'import { Event as CesiumEvent } from "cesium";',
  setup = "",
  afterRegistration = "",
  registration = "changed.addEventListener(listener);",
  cleanup = "() =>",
  effect = "() =>",
  release = "changed.removeEventListener(listener);",
}: {
  constructorImport?: string;
  setup?: string;
  afterRegistration?: string;
  registration?: string;
  cleanup?: string;
  effect?: string;
  release?: string;
} = {}) => `
  ${constructorImport}
  import { useEffect } from "react";
  function Status({ active, publish, renderMessage }) {
    const changed = new CesiumEvent();
    ${setup}
    useEffect(${effect} {
      if (!active) return;
      const listener = (message) => renderMessage(message);
      ${registration}
      ${afterRegistration}
      return ${cleanup} { ${release} };
    }, [active, changed, renderMessage]);
    return <button onClick={() => changed.raiseEvent("ready")}>Refresh</button>;
  }
`;

describe("Cesium event listener cleanup", () => {
  it("matches the same unary callback on a locally owned Cesium Event", () => {
    const result = runRule(effectNeedsCleanup, buildSource());
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["another callback", { release: "changed.removeEventListener(() => {});" }],
    [
      "another receiver",
      {
        setup: "const other = new CesiumEvent();",
        release: "other.removeEventListener(listener);",
      },
    ],
    ["a different callback scope", { release: "changed.removeEventListener(listener, {});" }],
    ["missing cleanup", { release: "" }],
    ["a generator cleanup", { cleanup: "function* ()" }],
    ["asynchronous effect setup", { effect: "async () =>" }],
    [
      "another import that changes the Event prototype",
      {
        constructorImport: 'import { Event as CesiumEvent, Event as OtherEvent } from "cesium";',
        setup: "OtherEvent.prototype.removeEventListener = () => false;",
      },
    ],
    ["a cleanup that needs an argument", { cleanup: "({ unused }) =>" }],
    [
      "different calls to a listener factory",
      {
        setup: "const make = () => () => {};",
        registration: "changed.addEventListener(make());",
        release: "changed.removeEventListener(make());",
      },
    ],
    [
      "a callback that throws before setup returns",
      {
        setup: "const stop = () => { throw new Error('stop'); };",
        afterRegistration: "stop();",
      },
    ],
    [
      "repeated registration",
      { registration: "changed.addEventListener(listener); changed.addEventListener(listener);" },
    ],
    [
      "registration inside a loop",
      {
        registration: "for (let index = 0; index < 2; index++) changed.addEventListener(listener);",
      },
    ],

    ["an early return after setup", { afterRegistration: "if (publish) return;" }],
    [
      "a preceding call in cleanup",
      { release: "publish(); changed.removeEventListener(listener);" },
    ],
    [
      "a different callback scope in a spread",
      { release: "changed.removeEventListener(...[listener, {}]);" },
    ],
    ["a conditional cleanup", { release: "if (publish) changed.removeEventListener(listener);" }],
    [
      "an unknown constructor",
      { constructorImport: 'import { Event as CesiumEvent } from "events-adapter";' },
    ],
    ["a replaced removal method", { setup: "changed.removeEventListener = () => false;" }],
    ["an escaped receiver", { setup: "publish(changed);" }],
    ["an exposed constructor", { setup: "publish(CesiumEvent);" }],
  ])("still warns for %s", (_description, options) => {
    const result = runRule(effectNeedsCleanup, buildSource(options));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
