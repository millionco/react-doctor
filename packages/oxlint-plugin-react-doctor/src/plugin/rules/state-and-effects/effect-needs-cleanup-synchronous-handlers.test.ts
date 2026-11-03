import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("retained handlers with synchronous timer release", () => {
  it.each([
    ["local constant", "const handle = setInterval(task, 1000); clearInterval(handle);"],
    [
      "qualified native calls",
      "const handle = window.setInterval(task, 1000); window.clearInterval(handle);",
    ],
    ["shared timer cancellation", "const handle = setInterval(task, 1000); clearTimeout(handle);"],
    [
      "exhaustive branches",
      "const handle = setInterval(task, 1000); if (enabled) clearInterval(handle); else clearInterval(handle);",
    ],
    [
      "conditional allocation",
      "if (enabled) { const handle = setInterval(task, 1000); clearInterval(handle); }",
    ],
    ["unreassigned let", "let handle = setInterval(task, 1000); clearInterval(handle);"],
    ["ordinary var", "var handle=setInterval(task,1000); clearInterval(handle);"],
    [
      "release inside prior disposal scope",
      "{ using resource = { [Symbol.dispose]() { throw new Error('dispose'); } }; var handle = setInterval(task,1000); clearInterval(handle); }",
    ],
    [
      "release inside prior async disposal scope",
      "{ await using resource = disposable; var handle = setInterval(task,1000); clearInterval(handle); }",
    ],
    [
      "release before later acquisition and disposal",
      "const handle=setInterval(task,1000); clearInterval(handle); using resource=disposable;",
    ],
    [
      "release before later async acquisition and disposal",
      "const handle=setInterval(task,1000); clearInterval(handle); await using resource=disposable;",
    ],
    [
      "outer finally after prior disposal",
      "try { using resource=disposable; var handle: number | undefined = setInterval(task,1000); } finally { clearInterval(handle); }",
    ],
    [
      "outer finally after return and disposal",
      "try { using resource=disposable; var handle: number | undefined = setInterval(task,1000); return; } finally { clearInterval(handle); }",
    ],
    [
      "outer finally after throw and disposal",
      "try { using resource=disposable; var handle: number | undefined = setInterval(task,1000); throw {}; } finally { clearInterval(handle); }",
    ],
    [
      "release inside finalizer before acquisition and disposal",
      "const handle=setInterval(task,1000); try {} finally { clearInterval(handle); using resource=disposable; }",
    ],
    [
      "outer finally owns allocation in a finalizer disposal scope",
      "try { try {} finally { using resource=disposable; var handle: number | undefined=setInterval(task,1000); } } finally { clearInterval(handle); }",
    ],
    [
      "outer finally owns acquisition failure",
      "const candidate = { get [Symbol.dispose](): () => void { throw new Error('acquire'); } }; const handle=setInterval(task,1000); try { using resource=candidate; } finally { clearInterval(handle); }",
    ],
    [
      "optional native cancellation",
      "const handle = setInterval(task, 1000); clearInterval?.(handle);",
    ],
    [
      "optional qualified native cancellation",
      "const handle = setInterval(task, 1000); window.clearInterval?.(handle);",
    ],
    [
      "constant alias",
      "const handle = setInterval(task, 1000); const alias = handle; clearInterval(alias);",
    ],
    [
      "alias through finally return",
      "const handle = setInterval(task, 1000); const alias = handle; try { return; } finally { clearInterval(alias); }",
    ],
    [
      "finally after a throwing call",
      "const handle = setInterval(task, 1000); try { mayThrow(); } finally { clearInterval(handle); }",
    ],
    [
      "finally after return",
      "const handle = setInterval(task, 1000); try { if (enabled) return; mayThrow(); } finally { clearInterval(handle); }",
    ],
    [
      "finally after explicit throw",
      "const handle = setInterval(task, 1000); try { throw new Error('failure'); } finally { clearInterval(handle); }",
    ],
    [
      "allocation in a try block",
      "try { const handle = setInterval(task, 1000); clearInterval(handle); } catch {}",
    ],
    [
      "caught exceptions",
      "const handle = setInterval(task, 1000); try { mayThrow(); } catch {} clearInterval(handle);",
    ],
    [
      "nested finally",
      "const handle = setInterval(task, 1000); try { try { mayThrow(); } finally { mayThrow(); } } finally { clearInterval(handle); }",
    ],
    [
      "release before a later throw",
      "const handle = setInterval(task, 1000); clearInterval(handle); mayThrow();",
    ],
    [
      "one releasing branch and continuation",
      "const handle = setInterval(task, 1000); if (enabled) { clearInterval(handle); return; } clearInterval(handle);",
    ],
    [
      "known nonthrowing built-in",
      "const handle = setInterval(task, 1000); console.log('cancel'); clearInterval(handle);",
    ],
  ])("accepts %s in named and inline JSX handlers", (_name, body) => {
    for (const inline of [false, true]) {
      const result = runRule(
        effectNeedsCleanup,
        `
        declare namespace JSX { interface IntrinsicElements { button: { onClick: () => void }; } }
        declare const React: { createElement: (tag: string, props: { onClick: () => void }) => unknown };
        declare const task: () => void;
        declare const mayThrow: () => void;
        declare const disposable: Disposable;
        interface ButtonProps { enabled: boolean; }
        const Button = ({ enabled }: ButtonProps) => {
          ${inline ? "" : `const handleClick = ${body.includes("await ") ? "async " : ""}() => { ${body} };`}
          return <button onClick={${inline ? `${body.includes("await ") ? "async " : ""}() => { ${body} }` : "handleClick"}} />;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it.each([
    ["missing release", "setInterval(task, 1000);"],
    [
      "conditional release",
      "const handle = setInterval(task, 1000); if (enabled) clearInterval(handle);",
    ],
    [
      "overwritten allocation",
      "let handle = setInterval(task, 1000); handle = setInterval(task, 1000); clearInterval(handle);",
    ],
    [
      "reassigned handle",
      "let handle = setInterval(task, 1000); handle = 0; clearInterval(handle);",
    ],
    ["wrong handle", "const handle = setInterval(task, 1000); clearInterval(0);"],
    [
      "deferred release",
      "const handle = setInterval(task, 1000); const release = () => clearInterval(handle); void release;",
    ],
    [
      "early return",
      "const handle = setInterval(task, 1000); if (enabled) return; clearInterval(handle);",
    ],
    [
      "unknown throwing call",
      "const handle = setInterval(task, 1000); mayThrow(); clearInterval(handle);",
    ],
    [
      "explicit throw",
      "const handle = setInterval(task, 1000); throw new Error('failure'); clearInterval(handle);",
    ],
    [
      "throwing condition",
      "const handle = setInterval(task, 1000); if (mayThrow()) clearInterval(handle); else clearInterval(handle);",
    ],
    [
      "throwing property access",
      "const handle = setInterval(task, 1000); void source.value; clearInterval(handle);",
    ],
    [
      "throwing built-in argument",
      "const handle = setInterval(task, 1000); console.log(source.value); clearInterval(handle);",
    ],
    [
      "throw before finally",
      "const handle = setInterval(task, 1000); mayThrow(); try {} finally { clearInterval(handle); }",
    ],
    [
      "throw in finally",
      "const handle = setInterval(task, 1000); try {} finally { mayThrow(); clearInterval(handle); }",
    ],
    [
      "conditional finally release",
      "const handle = setInterval(task, 1000); try { mayThrow(); } finally { if (enabled) clearInterval(handle); }",
    ],
    [
      "return before finally release",
      "const handle = setInterval(task, 1000); try { mayThrow(); } finally { if (enabled) return; clearInterval(handle); }",
    ],
    [
      "shadowed handle",
      "const handle = setInterval(task, 1000); { const handle = 0; clearInterval(handle); }",
    ],
    [
      "shadowed cleanup",
      "const clearInterval = (_handle: number) => {}; const handle = setInterval(task, 1000); clearInterval(handle);",
    ],
    [
      "written global cleanup",
      "globalThis.clearInterval = (_handle?: number) => {}; const handle = setInterval(task, 1000); clearInterval(handle);",
    ],
    [
      "written qualified cleanup",
      "window.clearInterval = (_handle?: number) => {}; const handle = setInterval(task, 1000); clearInterval(handle);",
    ],
    [
      "nullable custom release",
      "const release = enabled ? clearInterval : undefined; const handle = setInterval(task, 1000); release?.(handle);",
    ],
    [
      "throwing disposal",
      "const handle=setInterval(task,1000); { using resource=disposable; } clearInterval(handle);",
    ],
    [
      "prior disposal bypasses outer release",
      "{ using resource = { [Symbol.dispose]() { throw new Error('dispose'); } }; var handle = setInterval(task,1000); } clearInterval(handle);",
    ],
    [
      "prior async disposal bypasses outer release",
      "{ await using resource=disposable; var handle=setInterval(task,1000); } clearInterval(handle);",
    ],
    [
      "prior async disposal delays outer finally",
      "try { await using resource=disposable; var handle: number | undefined=setInterval(task,1000); } finally { clearInterval(handle); }",
    ],
    [
      "finalizer disposal bypasses outer release",
      "const handle=setInterval(task,1000); try {} finally { using resource=disposable; } clearInterval(handle);",
    ],
    [
      "allocation in finalizer disposal bypasses outer release",
      "try {} finally { using resource=disposable; var handle=setInterval(task,1000); } clearInterval(handle);",
    ],
    [
      "prior disposal and return bypass release",
      "{ using resource=disposable; var handle=setInterval(task,1000); if (enabled) return; } clearInterval(handle);",
    ],
    [
      "using acquisition bypasses release",
      "const candidate = { get [Symbol.dispose](): () => void { throw new Error('acquire'); } }; const handle=setInterval(task,1000); using resource=candidate; clearInterval(handle);",
    ],
    [
      "await using acquisition bypasses release",
      "const candidate = { get [Symbol.asyncDispose](): () => Promise<void> { throw new Error('acquire'); } }; const handle=setInterval(task,1000); await using resource=candidate; clearInterval(handle);",
    ],
    [
      "asynchronous disposal",
      "const handle=setInterval(task,1000); { await using resource=disposable; } clearInterval(handle);",
    ],
    [
      "unindexed catch default handle write",
      "let handle=setInterval(task,1000); try { throw {}; } catch ({ unused=(handle=0) }: any) {} finally { clearInterval(handle); }",
    ],
    [
      "unindexed globalThis replacement",
      "try { throw {}; } catch ({ unused=(globalThis.clearInterval=()=>{}) }: any) {} const handle=setInterval(task,1000); clearInterval(handle);",
    ],
    [
      "unindexed window replacement",
      "try { throw {}; } catch ({ unused=(window.clearInterval=()=>{}) }: any) {} const handle=setInterval(task,1000); clearInterval(handle);",
    ],
    [
      "unindexed namespace alias replacement",
      "const host=globalThis; try { throw {}; } catch ({ unused=(host.clearInterval=()=>{}) }: any) {} const handle=setInterval(task,1000); clearInterval(handle);",
    ],
    [
      "direct eval writes",
      "let handle = setInterval(task, 1000); try { eval('handle = 0'); } finally { clearInterval(handle); }",
    ],
    [
      "suspension before finally",
      "const handle = setInterval(task, 1000); try { await Promise.resolve(); } finally { clearInterval(handle); }",
    ],
  ])("preserves the warning for %s", (_name, body) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      declare const task: () => void;
      declare const mayThrow: () => boolean;
      declare const source: { value: unknown };
      declare const disposable: Disposable;
      interface ButtonProps { enabled: boolean; }
      const Button = ({ enabled }: ButtonProps) => {
        const handleClick = async () => { ${body} };
        return <button onClick={handleClick} />;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves the existing release-before-assignment escape behavior", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      declare const task: () => void;
      const Button = () => {
        const handleClick = () => {
          let handle: number | undefined;
          clearInterval(handle);
          handle = setInterval(task, 1000);
        };
        return <button onClick={handleClick} />;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
