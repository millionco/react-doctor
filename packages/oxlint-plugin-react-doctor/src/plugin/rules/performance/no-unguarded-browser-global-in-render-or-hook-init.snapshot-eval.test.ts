import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedBrowserGlobalInRenderOrHookInit } from "./no-unguarded-browser-global-in-render-or-hook-init.js";

const hook = `
  function useReady() {
    return useSyncExternalStore(() => () => {}, () => true, () => false);
  }
`;
const viewport = `
  export const Panel = () => {
    const ready = useReady();
    return ready ? window.innerWidth : 0;
  };
`;

describe("browser reads guarded by a local server snapshot near eval", () => {
  it.each([
    ["a stable function", hook + viewport, 0],
    ["direct hook reassignment", hook + "eval('useReady = () => true');" + viewport, 1],
    ["ordinary assignment", hook + "useReady = () => true;" + viewport, 1],
    ["indirect eval", hook + "(0, eval)('useReady = () => true');" + viewport, 0],
    ["no-argument eval", hook + "eval();" + viewport, 0],
    [
      "a nested scope with a separate runtime binding",
      hook + "((useReady) => eval('useReady = () => true'))(null);" + viewport,
      0,
    ],
    [
      "eval in a sibling of the local hook scope",
      "function sibling() { eval(code); }" +
        `export const Panel = () => {
          ${hook}
          const ready = useReady();
          return ready ? window.innerWidth : 0;
        };`,
      0,
    ],
    [
      "an immutable hook and callback",
      `const readSnapshot = () => false;
       const useReady = () => useSyncExternalStore(() => () => {}, () => true, readSnapshot);
       eval(code);` + viewport,
      0,
    ],
    [
      "a directly referenced mutable snapshot callback",
      `function readSnapshot() { return false; }
       eval('readSnapshot = () => true');
       const useReady = () => useSyncExternalStore(() => () => {}, () => true, readSnapshot);` +
        viewport,
      1,
    ],
    [
      "a block-local function shadows the outer hook",
      hook + `(() => { { function useReady() {} eval('useReady = () => true'); } })();` + viewport,
      0,
    ],
    [
      "an unrelated type declaration cannot hide a runtime parameter shadow",
      hook +
        `((useReady) => { type useReady = boolean; eval('useReady = () => true'); })(null);` +
        viewport,
      0,
    ],
    [
      "an early-return guard using a reassigned hook",
      hook +
        "eval('useReady = () => true');" +
        viewport.replace(
          "return ready ? window.innerWidth : 0;",
          "if (!ready) return 0; return window.innerWidth;",
        ),
      1,
    ],
    [
      "a case-body eval with a real case-local shadow",
      hook + `switch (1) { case 1: let useReady; eval('useReady = () => true'); }` + viewport,
      0,
    ],
    [
      "a catch pattern default with a real catch-parameter shadow",
      hook +
        `try { throw {}; } catch ({ useReady, flag = eval('useReady = () => true') }) {}` +
        viewport,
      0,
    ],
    [
      "a mutable declaration in the function body is not visible from its parameter default",
      hook +
        `export const Panel = (_ = eval('useReady = () => true')) => {
          ${hook}
          const ready = useReady();
          return ready ? window.innerWidth : 0;
        };`,
      0,
    ],
    [
      "a runtime enum shadows the outer hook",
      hook + `(() => { enum useReady { Marker } eval('useReady = () => true'); })();` + viewport,
      0,
    ],
    [
      "a catch default closure whose own parameter shadows the hook",
      hook +
        `try { throw {}; } catch ({ run = (useReady) => eval('useReady = () => true') }) { run(null); }` +
        viewport,
      0,
    ],
    [
      "a catch default closure whose own local variable shadows the hook",
      hook +
        `try { throw {}; } catch ({ run = () => { let useReady; eval('useReady = () => true'); } }) { run(); }` +
        viewport,
      0,
    ],
    [
      "a catch default closure with a real catch-parameter shadow",
      hook +
        `try { throw {}; } catch ({ useReady, run = () => eval('useReady = () => true') }) { run(); }` +
        viewport,
      0,
    ],
    [
      "nested catch pattern scopes preserve an enclosing closure parameter",
      hook +
        `try { throw {}; } catch ({ run = (useReady) => {
          try { throw {}; } catch ({ change = () => eval('useReady = () => true') }) { change(); }
        } }) { run(null); }` +
        viewport,
      0,
    ],
    [
      "direct eval in the same function body as the hook declaration",
      `export const Panel = () => {
        ${hook}
        eval('useReady = () => true');
        const ready = useReady();
        return ready ? window.innerWidth : 0;
      };`,
      1,
    ],
    [
      "direct eval in the same function body as the snapshot callback",
      `export const Panel = () => {
        function readSnapshot() { return false; }
        eval('readSnapshot = () => true');
        const ready = useSyncExternalStore(() => () => {}, () => true, readSnapshot);
        return ready ? window.innerWidth : 0;
      };`,
      1,
    ],
    [
      "direct eval next to a named exported hook declaration",
      hook.replace("function useReady", "export function useReady") +
        "eval('useReady = () => true');" +
        viewport,
      1,
    ],
    ["a nonstring literal eval", hook + "eval(0);" + viewport, 0],
    ["an empty literal eval", hook + "eval('');" + viewport, 0],
    ["a pure literal expression", hook + "eval('1 + 1');" + viewport, 0],
    ["invalid literal syntax", hook + "eval('(');" + viewport, 0],
    ["opaque eval input", hook + "eval(code);" + viewport, 0],
    ["the same false result", hook + "eval('useReady = () => false');" + viewport, 0],
    [
      "the same true result",
      hook.replace("() => false", "() => true") +
        "eval('useReady = () => true');" +
        viewport.replace("ready ?", "!ready ?"),
      0,
    ],
    [
      "an assignment to another binding",
      hook + "function other() {} eval('other = () => true');" + viewport,
      0,
    ],
    [
      "a later eval restores the original value",
      hook + "eval('useReady = () => true'); eval('useReady = () => false');" + viewport,
      0,
    ],
    [
      "a const alias captures the earlier function",
      hook +
        "const useAlias = useReady; eval('useReady = () => true');" +
        viewport.replace("useReady()", "useAlias()"),
      0,
    ],
    [
      "a replaced global eval provider",
      hook + "globalThis.eval = () => undefined; eval('useReady = () => true');" + viewport,
      0,
    ],
    [
      "a possibly effectful prefix",
      hook + "invokeEarly(); eval('useReady = () => true');" + viewport,
      0,
    ],
    [
      "an immutable inline snapshot",
      `eval(code);
       const useReady = () => useSyncExternalStore(() => () => {}, () => true, () => false);` +
        viewport,
      0,
    ],
  ])("checks %s", (_name, source, expectedCount) => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `import { useSyncExternalStore } from "react";
${source}`,
      { filename: "src/components/panel.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
