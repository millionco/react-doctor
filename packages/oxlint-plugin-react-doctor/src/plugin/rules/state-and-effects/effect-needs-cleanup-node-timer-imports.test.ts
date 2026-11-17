import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("Node builtin timer imports", () => {
  it.each([
    [
      "direct native pair",
      'import { setInterval, clearInterval } from "node:timers";',
      "const timer = setInterval(refresh, 100); return () => clearInterval(timer);",
      0,
    ],
    [
      "renamed pair",
      'import { setInterval as start, clearTimeout as stop } from "node:timers";',
      "const timer = start(refresh, 100); return () => stop(timer);",
      0,
    ],
    [
      "static namespace members",
      'import * as timers from "timers";',
      'const timer = timers["setInterval"](refresh, 100); return () => timers.clearTimeout(timer);',
      0,
    ],
    [
      "named and namespace handles",
      'import { setInterval as start } from "node:timers"; import * as timers from "timers";',
      "const timer = start(refresh, 100); return () => timers.clearInterval(timer);",
      0,
    ],
    [
      "collection clearer",
      'import { setInterval as start, clearInterval as stop } from "node:timers";',
      "const timers = [start(refresh, 100), start(refresh, 200)]; return () => timers.forEach(stop);",
      0,
    ],
    [
      "existing direct-name global cleanup",
      'import { setInterval } from "node:timers";',
      "const timer = setInterval(refresh, 100); return () => globalThis.clearInterval(timer);",
      0,
    ],
    [
      "renamed leak",
      'import { setInterval as start } from "node:timers";',
      "start(refresh, 100);",
      1,
    ],
    [
      "namespace leak",
      'import * as timers from "node:timers";',
      "timers.setInterval(refresh, 100);",
      1,
    ],
    [
      "wrong handle",
      'import { setInterval, clearInterval } from "node:timers";',
      "setInterval(refresh, 100); return () => clearInterval(otherTimer);",
      1,
    ],
    [
      "conditional cleanup",
      'import { setInterval, clearInterval } from "node:timers";',
      "const timer = setInterval(refresh, 100); return () => { if (enabled) clearInterval(timer); };",
      1,
    ],
    [
      "shadowed clearer",
      'import { setInterval, clearInterval as stop } from "node:timers";',
      "const stop = () => {}; const timer = setInterval(refresh, 100); return () => stop(timer);",
      1,
    ],
    [
      "written namespace member",
      'import { setInterval } from "node:timers"; import * as timers from "node:timers"; timers.clearInterval = () => {};',
      "const timer = setInterval(refresh, 100); return () => timers.clearInterval(timer);",
      1,
    ],
    [
      "escaped namespace object",
      'import { setInterval } from "node:timers"; import * as timers from "node:timers"; const alias = timers; alias.clearInterval = () => {};',
      "const timer = setInterval(refresh, 100); return () => timers.clearInterval(timer);",
      1,
    ],
    [
      "replaced builtin export",
      'import { setInterval, clearInterval } from "node:timers"; import timers from "node:timers"; import { syncBuiltinESMExports as sync } from "node:module"; timers.clearInterval = () => {}; sync();',
      "const timer = setInterval(refresh, 100); return () => clearInterval(timer);",
      1,
    ],
    [
      "unproven clearer with side effects",
      'import { setInterval, clearInterval } from "node:timers";',
      "const timer = setInterval(refresh, 100); return () => clearInterval(timer, throwNow());",
      1,
    ],
    [
      "browser timer with imported clearer",
      'import { clearInterval } from "node:timers";',
      "const timer = window.setInterval(refresh, 100); return () => clearInterval(timer);",
      1,
    ],
    [
      "Node timer with browser clearer",
      'import { setInterval } from "node:timers";',
      "const timer = setInterval(refresh, 100); return () => window.clearInterval(timer);",
      1,
    ],
    [
      "renamed Node timer with native bare clearer",
      'import { setInterval as start } from "node:timers";',
      "const timer = start(refresh, 100); return () => clearInterval(timer);",
      0,
    ],
    [
      "renamed Node timer with native globalThis clearer",
      'import { setInterval as start } from "node:timers";',
      "const timer = start(refresh, 100); return () => globalThis.clearTimeout(timer);",
      0,
    ],
    [
      "Node namespace timer with native bare clearer",
      'import * as timers from "node:timers";',
      "const timer = timers.setInterval(refresh, 100); return () => clearInterval(timer);",
      0,
    ],
    [
      "bare timer module alias with unproven global clearer",
      'import { setInterval as start } from "timers";',
      "const timer = start(refresh, 100); return () => clearInterval(timer);",
      1,
    ],
    [
      "renamed Node timer with browser clearer",
      'import { setInterval as start } from "node:timers";',
      "const timer = start(refresh, 100); return () => self.clearInterval(timer);",
      1,
    ],
    [
      "replaced bare clearer",
      'import { setInterval as start } from "node:timers"; globalThis.clearInterval = () => {};',
      "const timer = start(refresh, 100); return () => clearInterval(timer);",
      1,
    ],
    [
      "alternate global object with replaced clearer",
      'import { setInterval as start } from "node:timers"; document.defaultView.clearInterval = () => {};',
      "const timer = start(refresh, 100); return () => clearInterval(timer);",
      1,
    ],
    [
      "renamed Node timer with extra cleanup argument",
      'import { setInterval as start } from "node:timers";',
      "const timer = start(refresh, 100); return () => clearInterval(timer, throwNow());",
      1,
    ],
    [
      "foreign package",
      'import { setInterval as start } from "foreign-timers";',
      "start(refresh, 100);",
      0,
    ],
    [
      "promise timers",
      'import * as timers from "node:timers/promises";',
      "timers.setInterval(100);",
      0,
    ],
  ])("%s", (_label, imports, body, expected) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
       ${imports}
       export const Clock = () => {
         useEffect(() => { ${body} }, []);
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
