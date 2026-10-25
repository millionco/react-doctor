import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";
import { ASYNC_FINALLY_STRESS_LAYER_COUNT } from "./utils/constants.js";

interface FinallyCompletionCase {
  readonly name: string;
  readonly body: string;
  readonly expected: number;
}

const finallyCompletionCases: ReadonlyArray<FinallyCompletionCase> = [
  {
    name: "return runs an unsafe finally",
    body: "try { await readValue(id); return; } finally { setValue(1); }",
    expected: 1,
  },
  {
    name: "throw runs an unsafe finally",
    body: 'try { await readValue(id); throw new Error("stop"); } finally { setValue(1); }',
    expected: 1,
  },
  {
    name: "normal completion still runs finally",
    body: "try { await readValue(id); } finally { setValue(1); }",
    expected: 1,
  },
  {
    name: "guarded finally remains safe on return",
    body: "try { await readValue(id); return; } finally { if (!cancelled) setValue(1); }",
    expected: 0,
  },
  {
    name: "nested return reaches inner finally",
    body: "try { try { await readValue(id); return; } finally { setValue(1); } } finally {}",
    expected: 1,
  },
  {
    name: "return before suspension reaches awaited finally",
    body: "try { return; } finally { await readValue(id); setValue(1); }",
    expected: 1,
  },
  {
    name: "throwing finally leaves following setter unreachable",
    body: 'try { await readValue(id); return; } finally { throw new Error("stop"); } setValue(1);',
    expected: 0,
  },
  {
    name: "conditional finalizer return preserves pending return",
    body: "try { await readValue(id); return; } finally { if (cancelled) return; } setValue(1);",
    expected: 0,
  },
  {
    name: "early cancellation return still executes unguarded finally",
    body: "try { await readValue(id); if (cancelled) return; } finally { setValue(1); }",
    expected: 1,
  },
  {
    name: "return await argument is evaluated before finally",
    body: "try { return await readValue(id); } finally { setValue(1); }",
    expected: 1,
  },
  {
    name: "throw await argument is evaluated before finally",
    body: "try { throw await readValue(id); } finally { setValue(1); }",
    expected: 1,
  },
  {
    name: "return argument setter is evaluated after suspension",
    body: "await readValue(id); return setValue(1);",
    expected: 1,
  },
  {
    name: "throw argument setter is evaluated after suspension",
    body: "await readValue(id); throw setValue(1);",
    expected: 1,
  },
  {
    name: "inner finalizer return still executes outer finally",
    body: 'try { try { await readValue(id); throw new Error("stop"); } finally { return; } } finally { setValue(1); }',
    expected: 1,
  },
  {
    name: "empty nested finalizers preserve a return",
    body: "try { try { await readValue(id); return; } finally {} } finally {} setValue(1);",
    expected: 0,
  },
  {
    name: "finalizer return overrides a throw",
    body: 'try { await readValue(id); throw new Error("stop"); } finally { return; } setValue(1);',
    expected: 0,
  },
  {
    name: "catch consumes throw and can complete normally",
    body: 'try { await readValue(id); throw new Error("stop"); } catch {} setValue(1);',
    expected: 1,
  },
  {
    name: "catch return prevents following setter",
    body: "try { await readValue(id); return; } catch { return; } finally {} setValue(1);",
    expected: 0,
  },
  {
    name: "catch return still reaches finally",
    body: 'try { await readValue(id); throw new Error("stop"); } catch { return; } finally { setValue(1); }',
    expected: 1,
  },
  {
    name: "catch throw still reaches finally",
    body: 'try { await readValue(id); throw new Error("first"); } catch { throw new Error("second"); } finally { setValue(1); }',
    expected: 1,
  },
  {
    name: "inner throw override reaches outer catch guard",
    body: 'try { try { await readValue(id); return; } finally { throw new Error("stop"); } } catch { if (cancelled) return; setValue(1); }',
    expected: 0,
  },
  {
    name: "finally guard can return before unsafe setter",
    body: "try { await readValue(id); return; } finally { if (cancelled) return; setValue(1); }",
    expected: 0,
  },
  {
    name: "second finalizer suspension invalidates earlier guard",
    body: "try { await readValue(id); return; } finally { if (cancelled) return; await readValue(id); setValue(1); }",
    expected: 1,
  },
  {
    name: "uninvoked finalizer callback stays quiet",
    body: "try { await readValue(id); return; } finally { const later = () => setValue(1); }",
    expected: 0,
  },
  {
    name: "return before suspension stays quiet",
    body: "try { return; await readValue(id); } finally { setValue(1); }",
    expected: 0,
  },
  {
    name: "both branch returns reach finally",
    body: "try { await readValue(id); if (flag) return; else return; } finally { setValue(1); }",
    expected: 1,
  },
  {
    name: "switch return reaches finally",
    body: "try { switch (id) { case 1: await readValue(id); return; default: return; } } finally { setValue(1); }",
    expected: 1,
  },
  {
    name: "existing loop approximation still sees nested finally",
    body: "while (flag) { try { await readValue(id); return; } finally { setValue(1); } }",
    expected: 1,
  },
];

describe("no-set-state-after-await-in-effect finally completions", () => {
  for (const testCase of finallyCompletionCases) {
    it(testCase.name, () => {
      const result = runRule(
        noSetStateAfterAwaitInEffect,
        `
        import { useEffect, useState } from "react";
        const Example = ({ id, readValue, flag }) => {
          const [value, setValue] = useState(0);
          useEffect(() => {
            let cancelled = false;
            const run = async () => {
              ${testCase.body}
            };
            void run();
            return () => { cancelled = true; };
          }, [id, readValue, flag]);
          return value;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }

  for (const expected of [0, 1]) {
    it(`deduplicates deep conditional finalizer completions with expected ${expected}`, () => {
      let body = expected === 1 ? "setValue(1);" : "if (cancelled) return; setValue(1);";
      for (let depth = 0; depth < ASYNC_FINALLY_STRESS_LAYER_COUNT; depth += 1) {
        body = `try { if (flag) return; } finally { ${body} }`;
      }
      const result = runRule(
        noSetStateAfterAwaitInEffect,
        `
        import { useEffect, useState } from "react";
        const Example = ({ id, readValue, flag }) => {
          const [value, setValue] = useState(0);
          useEffect(() => {
            let cancelled = false;
            const run = async () => {
              try { await readValue(id); return; } finally { ${body} }
            };
            void run();
            return () => { cancelled = true; };
          }, [id, readValue, flag]);
          return value;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    });
  }
});
