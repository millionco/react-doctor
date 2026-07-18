import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noBlockedPaste } from "./no-blocked-paste.js";

const run = (code: string) => runRule(noBlockedPaste, code, { filename: "field.tsx" });

describe("no-blocked-paste", () => {
  it("flags an inline paste handler that always prevents the event", () => {
    const result = run(
      `const Field = () => <input type="PASSWORD" onPaste={(event) => event.preventDefault()} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an exact local handler", () => {
    const result = run(
      `const blockPaste = (event) => { event.preventDefault(); }; const Field = () => <input autoComplete="one-time-code" onPaste={blockPaste} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags transparent event wrappers and unconditional block returns", () => {
    const result = run(`
      const Fields = () => <>
        <input type="password" onPaste={(event) => (event as any).preventDefault()} />
        <input type="password" onPaste={(event) => event!.preventDefault()} />
        <input type="password" onPaste={(event) => { return event["preventDefault"](); }} />
      </>;
    `);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("ignores preventDefault called on another object", () => {
    const result = run(
      `const Field = () => <input type="password" onPaste={(event) => controller.preventDefault(event)} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a shadowed event binding", () => {
    const result = run(`
      const Field = () => <input type="password" onPaste={(event) => {
        {
          const event = controller;
          event.preventDefault();
        }
      }} />;
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores conditional prevention", () => {
    const result = run(
      `const Field = ({ locked }) => <input type="password" onPaste={(event) => { if (locked) event.preventDefault(); }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores prevention after an earlier conditional return", () => {
    const result = run(
      `const Field = ({ enabled }) => <input type="password" onPaste={(event) => { if (!enabled) return; event.preventDefault(); }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores unreachable prevention after an unconditional return", () => {
    const result = run(
      `const Field = () => <input type="password" onPaste={(event) => { return; event.preventDefault(); }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores custom controls and spread-owned handlers", () => {
    const result = run(
      `const Field = (props) => <><Input type="password" onPaste={(event) => event.preventDefault()} /><input type="password" onPaste={(event) => event.preventDefault()} {...props} /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not descend into a nested callback", () => {
    const result = run(
      `const Field = () => <input type="password" onPaste={(event) => queueMicrotask(() => event.preventDefault())} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores non-authentication fields with an intentional paste policy", () => {
    const result = run(
      `const Confirm = () => <input onPaste={(event) => event.preventDefault()} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
