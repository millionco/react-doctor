import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const rule = wrapWithSemanticContext(effectNeedsCleanup) as Rule;
const registration = 'getChannel().addEventListener("update", listener);';
const release = 'getChannel().removeEventListener("update", listener)';

const source = (
  cleanup: string,
  moduleCode = "",
  handler = "() => {}",
  listenerRegistration = registration,
): string => `
  import { useEffect } from "react";
  let cache: BroadcastChannel | null = null;
  function createChannel() {
    if (typeof BroadcastChannel === "undefined") {
      return { addEventListener() {}, removeEventListener() {}, postMessage() {} };
    }
    return new BroadcastChannel("preferences");
  }
  function getChannel() {
    if (cache === null) {
      cache = createChannel();
    }
    return cache;
  }
  ${moduleCode}
  export function Preferences() {
    useEffect(() => {
      const listener = ${handler};
      ${listenerRegistration}
      ${cleanup}
    }, []);
    return null;
  }
`;

describe("effect-needs-cleanup cached BroadcastChannel listeners", () => {
  it.each([
    ["direct cleanup", source(`return () => ${release};`)],
    ["block cleanup", source(`return () => { ${release}; };`)],
    [
      "type members with the same names as the functions",
      source(
        `return () => ${release};`,
        "export interface Options { getChannel?: boolean; createChannel?: boolean; }",
      ),
    ],
    [
      "literal matching capture",
      source(
        'return () => getChannel().removeEventListener("update", listener, true);',
        "",
        "() => {}",
        'getChannel().addEventListener("update", listener, true);',
      ),
    ],
  ])("accepts %s", (_name, code) => {
    const result = runRule(rule, code, { filename: "preferences.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["missing cleanup", source("")],
    ["conditional cleanup", source(`return () => { if (location.hash) ${release}; };`)],
    ["early return", source(`return () => { if (location.hash) return; ${release}; };`)],
    ["generator cleanup", source(`return function* () { ${release}; };`)],
    [
      "fresh receiver",
      source('return () => createChannel().removeEventListener("update", listener);'),
    ],
    [
      "mismatched event",
      source('return () => getChannel().removeEventListener("other", listener);'),
    ],
    [
      "mismatched callback",
      source('return () => getChannel().removeEventListener("update", () => {});'),
    ],
    [
      "mismatched capture",
      source('return () => getChannel().removeEventListener("update", listener, true);'),
    ],
    [
      "resettable cache",
      source(`return () => ${release};`, "export function reset() { cache = null; }"),
    ],
    ["exported getter", source(`return () => ${release};`, "export { getChannel };")],
    [
      "ambient event receiver",
      source(
        `return () => ${release};`,
        "",
        "() => { document.defaultView.event.currentTarget.removeEventListener = () => {}; }",
      ),
    ],
    [
      "derived prototype mutation",
      source(
        `return () => ${release};`,
        "Object.getPrototypeOf(AbortSignal.prototype).removeEventListener = () => {};",
      ),
    ],
    [
      "a prototype mutation with a computed method name",
      source(
        `return () => ${release};`,
        "const methodName = `removeEventListener`; Object.getPrototypeOf(AbortSignal.prototype)[methodName] = () => {};",
      ),
    ],
    [
      "a loop that recreates the listener on every iteration",
      source(
        `
        let passes = 0;
        for (;;) {
          const listener = () => {};
          ${registration}
          if (++passes === 2) return () => ${release};
        }
      `,
        "",
        "() => {}",
        "",
      ),
    ],
    [
      "a finally block that overrides the cleanup return",
      source(`try { return () => ${release}; } finally { return () => {}; }`),
    ],
    [
      "allocation inside the effect without close",
      `
        import { useEffect } from "react";
        export function Preferences() {
          useEffect(() => {
            const channel = new BroadcastChannel("preferences");
            const listener = () => {};
            channel.addEventListener("update", listener);
            return () => channel.removeEventListener("update", listener);
          }, []);
          return null;
        }
      `,
    ],
  ])("retains the warning for %s", (_name, code) => {
    const result = runRule(rule, code, { filename: "preferences.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
