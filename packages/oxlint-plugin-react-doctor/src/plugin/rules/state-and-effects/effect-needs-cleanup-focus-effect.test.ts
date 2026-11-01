import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe.each(["expo-router", "@react-navigation/native", "@react-navigation/core"])(
  "effect-needs-cleanup useFocusEffect from %s",
  (moduleName) => {
    describe.each([
      ["inline", "useFocusEffect(useCallback(() => { BODY }, []));"],
      ["named", "const onFocus = useCallback(() => { BODY }, []); useFocusEffect(onFocus);"],
      ["direct", "useFocusEffect(() => { BODY });"],
      ["function", "function onFocus() { BODY } useFocusEffect(onFocus);"],
      [
        "alias",
        "const onFocus = useCallback(() => { BODY }, []); const alias = onFocus; useFocusEffect(alias);",
      ],
    ])("%s callback", (_, invocation) => {
      it.each([
        [
          "BackHandler",
          'const subscription = BackHandler.addEventListener("hardwareBackPress", onBack);',
          "return () => subscription.remove();",
        ],
        [
          "interval",
          "const timer = setInterval(tick, 1000);",
          "return () => clearInterval(timer);",
        ],
        ["timeout", "const timer = setTimeout(tick, 1000);", "return () => clearTimeout(timer);"],
        [
          "DOM listener",
          'window.addEventListener("resize", onResize);',
          'return () => window.removeEventListener("resize", onResize);',
        ],
      ])("accepts %s cleanup and reports missing cleanup once", (_, allocation, cleanup) => {
        for (const hasCleanup of [true, false]) {
          const result = runRule(
            effectNeedsCleanup,
            `
            import { useCallback } from "react";
            import { useFocusEffect } from "${moduleName}";
            import { BackHandler } from "react-native";
            function Screen() {
              ${invocation.replace("BODY", `${allocation} ${hasCleanup ? cleanup : ""}`)}
              return null;
            }
          `,
          );
          expect(result.parseErrors).toEqual([]);
          expect(result.diagnostics).toHaveLength(hasCleanup ? 0 : 1);
        }
      });
    });
  },
);

describe("effect-needs-cleanup focus effect boundaries", () => {
  it.each([
    ['import { useFocusEffect as useScreenEffect } from "expo-router";', "useScreenEffect"],
    ['import * as Navigation from "@react-navigation/native";', "Navigation.useFocusEffect"],
    ['import * as Navigation from "@react-navigation/native";', 'Navigation["useFocusEffect"]'],
    [
      'import { useFocusEffect } from "expo-router"; const useScreenEffect = useFocusEffect;',
      "useScreenEffect",
    ],
    [
      'import * as Navigation from "@react-navigation/native"; const { useFocusEffect: useScreenEffect } = Navigation;',
      "useScreenEffect",
    ],
  ])("resolves imported hook bindings: %s", (imports, hook) => {
    const result = runRule(
      effectNeedsCleanup,
      `${imports}
      function Screen() { ${hook}(() => { setInterval(tick, 1000); }); return null; }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    'import { useFocusEffect } from "some-other-library";',
    'import useFocusEffect from "expo-router";',
    'import type { useFocusEffect } from "expo-router";',
    "const useFocusEffect = (callback) => callback;",
    "",
  ])("does not trust an unsupported hook: %s", (imports) => {
    const result = runRule(
      effectNeedsCleanup,
      `${imports}
      function Screen() { useFocusEffect(() => { setInterval(tick, 1000); }); return null; }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "function Screen({ useFocusEffect }) { useFocusEffect(() => { setInterval(tick, 1000); }); return null; }",
    "function Screen({ Navigation }) { Navigation.useFocusEffect(() => { setInterval(tick, 1000); }); return null; }",
    "function Screen({ property }) { Navigation[property](() => { setInterval(tick, 1000); }); return null; }",
    "function Screen() { useFocusEffect(createCallback()); return null; }",
    "function Screen() { useFocusEffect(importedCallback); return null; }",
    "function Screen() { useFocusEffect(() => { const unused = () => setInterval(tick, 1000); }); return null; }",
  ])("keeps uncertain and unexecuted code quiet: %s", (body) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useFocusEffect } from "expo-router";
      import * as Navigation from "@react-navigation/native";
      import { importedCallback, createCallback } from "./callback";
      ${body}
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["return () => subscription.remove();", 0],
    ["if (enabled) return () => subscription.remove();", 1],
    ["return () => other.remove();", 1],
    ["return () => { const unused = () => subscription.remove(); };", 1],
    ["return subscription;", 1],
  ])("checks cleanup ownership: %s", (cleanup, diagnosticCount) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useFocusEffect } from "expo-router";
      import { useCallback } from "react";
      import { BackHandler } from "react-native";
      function Screen({ enabled, other }) {
        const onFocus = useCallback(() => {
          const subscription = BackHandler.addEventListener("hardwareBackPress", onBack);
          ${cleanup}
        }, [enabled, other]);
        useFocusEffect(onFocus);
        return null;
      }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });

  it.each([
    "useFocusEffect(React.useCallback((() => { BODY }) as () => void, []));",
    "const onFocus = React.useCallback(() => { BODY }, []); useFocusEffect((onFocus as () => void)!);",
    "const onFocus = () => { BODY }; useFocusEffect(React.useCallback(onFocus, []));",
    "function onFocus() { BODY } useFocusEffect(React.useCallback(onFocus, []));",
  ])("handles memoized callbacks and TypeScript wrappers: %s", (invocation) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import React from "react";
      import { useFocusEffect } from "expo-router";
      function Screen() {
        ${invocation.replace("BODY", "const timer = setInterval(tick, 1000); return () => clearInterval(timer);")}
        return null;
      }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not let focus cleanup hide a second event-handler use", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useCallback } from "react";
      import { useFocusEffect } from "expo-router";
      function Screen() {
        const onFocus = useCallback(() => {
          const timer = setInterval(tick, 1000);
          return () => clearInterval(timer);
        }, []);
        useFocusEffect(onFocus);
        return <button onClick={onFocus}>Start</button>;
      }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("function that outlives the render");
  });
});

describe("effect-needs-cleanup shared focus callbacks", () => {
  it.each([
    "const alias = onFocus; useFocusEffect(alias); useFocusEffect(alias);",
    "const alias = onFocus; const secondAlias = alias; useFocusEffect(secondAlias); useFocusEffect(alias);",
    "useFocusEffect(onFocus); useEffect(onFocus, []);",
    "useFocusEffect(onFocus); useLayoutEffect(onFocus, []);",
  ])("accepts cleanup consumed at every use: %s", (uses) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useCallback, useEffect, useLayoutEffect } from "react";
      import { useFocusEffect } from "expo-router";
      function Screen() {
        const onFocus = useCallback(() => {
          const timer = setInterval(tick, 1000);
          return () => clearInterval(timer);
        }, []);
        ${uses}
        return null;
      }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("effect-needs-cleanup forwarded focus cleanup", () => {
  it.each([
    ["return setup();", "return () => clearInterval(timer);", 0],
    ["const cleanup = setup(); return cleanup;", "return () => clearInterval(timer);", 0],
    ["setup();", "return () => clearInterval(timer);", 1],
    ["setup(); return setup();", "return () => clearInterval(timer);", 1],
    ["return setup();", "return () => clearInterval(other);", 1],
    ["return setup();", "if (enabled) return () => clearInterval(timer);", 1],
  ])("checks %s with %s", (invocation, cleanup, diagnosticCount) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useFocusEffect } from "expo-router";
      import { useCallback } from "react";
      function Screen({ enabled, other }) {
        const onFocus = useCallback(() => {
          const setup = () => {
            const timer = setInterval(tick, 1000);
            ${cleanup}
          };
          ${invocation}
        }, []);
        useFocusEffect(onFocus);
        return null;
      }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });
});

describe("effect-needs-cleanup focus callback binding precision", () => {
  it.each([
    [
      'import { useFocusEffect } from "@react-navigation/native"; import { useCallback as memoize } from "react";',
      "const callback = memoize(() => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, []); useFocusEffect(callback);",
      0,
    ],
    [
      'import { useFocusEffect } from "@react-navigation/core"; import * as React from "react";',
      "const callback = React.useCallback(() => { setInterval(tick, 1000); }, []); useFocusEffect(callback);",
      1,
    ],
    [
      'import { useFocusEffect } from "expo-router"; import { useCallback } from "custom-hooks";',
      "useFocusEffect(useCallback(() => { setInterval(tick, 1000); }, []));",
      0,
    ],
    [
      'import { useFocusEffect } from "expo-router";',
      "const useCallback = callback => () => callback; useFocusEffect(useCallback(() => { setInterval(tick, 1000); }, []));",
      0,
    ],
    [
      'import { useFocusEffect } from "expo-router"; import { useCallback } from "react";',
      "const invoke = (useCallback) => useFocusEffect(useCallback(() => { setInterval(tick, 1000); }, [])); invoke(factory);",
      0,
    ],
    [
      'import { useFocusEffect } from "expo-router"; import * as React from "react";',
      "const invoke = (React) => useFocusEffect(React.useCallback(() => { setInterval(tick, 1000); }, [])); invoke(factory);",
      0,
    ],
    [
      'import { useFocusEffect } from "expo-router"; import { useCallback } from "react";',
      "const callback = useCallback(() => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, []); const consume = (useFocusEffect) => useFocusEffect(callback); consume(customHook);",
      1,
    ],
    [
      'import { useFocusEffect } from "expo-router"; import { useCallback } from "react";',
      "const callback = useCallback(() => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, []); useFocusEffect(callback); retain(callback);",
      1,
    ],
    [
      'import { useFocusEffect } from "expo-router"; import { useCallback } from "react";',
      "const callback = useCallback(() => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, []); useFocusEffect(callback); const alias = callback; retain(alias);",
      1,
    ],
    [
      'import { useFocusEffect } from "expo-router"; import { useCallback } from "react";',
      "let focusHook = useFocusEffect; focusHook = customHook; focusHook(() => { setInterval(tick, 1000); });",
      0,
    ],
  ])("uses proven focus/memo bindings: %s %s", (imports, invocation, diagnosticCount) => {
    const result = runRule(
      effectNeedsCleanup,
      `${imports} function Screen() { ${invocation} return null; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });
});

describe("focus forwarding proof boundaries", () => {
  it.each([
    [
      "useFocusEffect",
      "const timer = setInterval(tick, 1000); afterAllocation(); return () => clearInterval(timer);",
    ],
    [
      "useEffect",
      'window.addEventListener("resize", onResize); afterAllocation(); return () => window.removeEventListener("resize", onResize);',
    ],
    [
      "useFocusEffect",
      'window.addEventListener("resize", onResize); afterAllocation(); return () => window.removeEventListener("resize", onResize);',
    ],
  ])("does not bypass allocator safety for %s", (hook, setupBody) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useCallback } from "react";
       import { useFocusEffect } from "expo-router";
       function Screen() {
         const callback = useCallback(() => { const setup = () => { ${setupBody} }; return setup(); }, []);
         ${hook === "useEffect" ? `useEffect(() => { const setup = () => { ${setupBody} }; return setup(); }, []);` : "useFocusEffect(callback);"}
         return null;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves directly owned inline focus timer forwarding", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
       import { useFocusEffect } from "expo-router";
       function Screen() {
         useFocusEffect(useCallback(() => {
           const setup = () => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); };
           return setup();
         }, []));
         return null;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("focus timer forwarding unsafe continuations", () => {
  it.each([
    "const setup = () => { const timer = setInterval(tick, 1000); return (opaqueThrowingCall(), () => clearInterval(timer)); }; return setup();",
    "const setup = () => { const timer = setInterval(tick, 1000); return () => { opaqueThrowingCall(); clearInterval(timer); }; }; return setup();",
    "const setup = () => { const timer = setInterval(tick, 1000); opaqueThrowingCall(); return () => clearInterval(timer); }; return setup();",
    "const setup = () => { const timer = setInterval(tick, 1000); state.throwingGetter; return () => clearInterval(timer); }; return setup();",
    "const setup = () => { const timer = setInterval(tick, 1000); beforeInitialization; const beforeInitialization = 1; return () => clearInterval(timer); }; return setup();",
    "const setup = async () => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }; return setup();",
    "const setup = () => { const timer = setInterval(tick, 1000); try { return () => clearInterval(timer); } finally { return () => {}; } }; return setup();",
    "const setup = () => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }; const cleanup = setup(); opaqueThrowingCall(); return cleanup;",
    "const setup = () => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }; const cleanup = setup(); state.throwingGetter; return cleanup;",
    "const setup = () => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }; const cleanup = setup(); beforeInitialization; const beforeInitialization = 1; return cleanup;",
    "const setup = () => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }; const cleanup = setup(); return (opaqueThrowingCall(), cleanup);",
    "const setup = () => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }; try { return setup(); } finally { return () => {}; }",
  ])("does not grant forwarded cleanup across unsupported code: %s", (body) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
      import { useFocusEffect } from "@react-navigation/native";
      function Screen() { const focus = useCallback(() => { ${body} }, []); useFocusEffect(focus); return null; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

it("does not execute an unadvanced focus setup generator", () => {
  const result = runRule(
    effectNeedsCleanup,
    `import { useCallback } from "react";
      import { useFocusEffect } from "@react-navigation/native";
      function Screen() { const focus = useCallback(() => {
        function* setup() { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }
        return setup();
      }, []); useFocusEffect(focus); return null; }`,
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});
