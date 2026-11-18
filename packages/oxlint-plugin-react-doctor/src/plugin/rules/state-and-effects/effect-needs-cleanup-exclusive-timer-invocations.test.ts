import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const setup = `
  if (ready) {
    try {
      risky();
      schedule(shortDelay);
    } catch {
      schedule(longDelay);
    }
  } else {
    schedule(longDelay);
  }
`;

interface TimerTestOptions {
  initialization?: string;
  helperTail?: string;
  cleanup?: string;
}

const diagnostics = (
  effectSetup: string,
  {
    initialization = "let timer: ReturnType<typeof setTimeout> | null = null;",
    helperTail = "",
    cleanup = "if (timer) clearTimeout(timer);",
  }: TimerTestOptions = {},
) =>
  runRule(
    effectNeedsCleanup,
    `import { useEffect } from "react";
     export function Demo({ ready, risky }) {
       const shortDelay = 10;
       const longDelay = 30;
       useEffect(() => {
         ${initialization}
         const schedule = (delay: number) => {
           timer = setTimeout(() => console.log("pending"), delay);
           ${helperTail}
         };
         ${effectSetup}
         return () => { ${cleanup} };
       }, [ready, risky]);
       return null;
     }`,
  ).diagnostics;

describe("effect-needs-cleanup mutually exclusive timer helper calls", () => {
  it("accepts terminal try, catch, and else calls sharing a local timer handle", () => {
    expect(diagnostics(setup)).toEqual([]);
  });

  it("accepts opposite terminal if and else arms", () => {
    expect(diagnostics("if (ready) schedule(shortDelay); else schedule(longDelay);")).toEqual([]);
  });

  it.each([
    [
      "a possible throw after scheduling in the try block",
      setup.replace("schedule(shortDelay);", "schedule(shortDelay); risky();"),
    ],
    ["a possible throw after the final setup branch", setup + "risky();"],
    ["sequential writes to the handle", "schedule(shortDelay); schedule(longDelay);"],
    [
      "looping invocations",
      "for (let i = 0; i < 2; i++) { if (ready) schedule(shortDelay); else schedule(longDelay); }",
    ],
    ["a possible delay coercion", setup.replace("schedule(shortDelay);", "schedule(getDelay());")],
    ["a scheduler reference handed to another owner", setup + "later(schedule);"],
  ])("keeps the warning for %s", (_reason, effectSetup) => {
    expect(diagnostics(effectSetup)).toHaveLength(1);
  });

  it("keeps the warning when the scheduling helper can throw after allocating", () => {
    expect(diagnostics(setup, { helperTail: "risky();" })).toHaveLength(1);
  });

  it("keeps the warning for a handle initialized after the scheduling call", () => {
    expect(diagnostics(setup + "let timer = null;", { initialization: "" })).toHaveLength(1);
  });

  it("keeps the warning for a handle that can be overwritten while live", () => {
    expect(
      diagnostics(setup, {
        initialization: 'let timer = setTimeout(() => console.log("first"), 5);',
      }),
    ).toHaveLength(1);
  });

  it("keeps the warning when a disposal hook can throw on the setup exit", () => {
    expect(
      diagnostics(setup, {
        initialization: "using resource = { [Symbol.dispose]() { risky(); } }; let timer = null;",
      }),
    ).toHaveLength(1);
  });

  it("keeps the warning for a replaced native timer provider", () => {
    expect(
      diagnostics(setup, {
        initialization: "globalThis.setTimeout = replacementScheduler; let timer = null;",
      }),
    ).toHaveLength(1);
  });

  it("keeps the warning when the clearTimeout binding is replaced", () => {
    expect(
      diagnostics(setup, {
        initialization: "globalThis.clearTimeout = replacementRelease; let timer = null;",
      }),
    ).toHaveLength(1);
  });

  it("keeps the warning when cleanup can throw before clearing the live handle", () => {
    expect(
      diagnostics(setup, { cleanup: "risky(); if (timer) clearTimeout(timer);" }),
    ).toHaveLength(1);
  });
});
