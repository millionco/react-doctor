import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUseBeforeDefine } from "./no-use-before-define.js";

const run = (code: string) => runRule(noUseBeforeDefine, code, { filename: "fixture.tsx" });

describe("no-use-before-define", () => {
  it("flags a read before its let declaration", () => {
    const result = run(`
      function compute() {
        const copy = value;
        let value = 1;
        return copy + value;
      }
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].nodeType).toBe("Identifier");
  });

  it("flags a read before its const declaration", () => {
    const result = run(`
      function compute() {
        console.log(answer);
        const answer = 42;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a class used before its declaration", () => {
    const result = run(`
      function build() {
        const instance = new Widget();
        class Widget {}
        return instance;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a write before its let declaration", () => {
    const result = run(`
      function compute() {
        value = 1;
        let value = 2;
        return value;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an access from a nested block before the outer declaration", () => {
    const result = run(`
      function compute(flag) {
        if (flag) {
          return total;
        }
        let total = 1;
        return total;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag a declared-but-unassigned let read (initialized to undefined)", () => {
    const result = run(`
      function compute(flag) {
        let value;
        if (flag) {
          value = 1;
        }
        return value;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a read after the declaration", () => {
    const result = run(`
      function compute() {
        let value = 1;
        const copy = value;
        return copy;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a const read after its declaration", () => {
    const result = run(`
      function compute() {
        const value = 1;
        return value;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a parameter", () => {
    const result = run(`
      function compute(value) {
        return value;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a hoisted var read before its declaration", () => {
    const result = run(`
      function compute() {
        const copy = value;
        var value = 1;
        return copy;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a hoisted function called before its declaration", () => {
    const result = run(`
      function compute() {
        greet();
        function greet() {}
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a forward reference deferred inside a nested closure", () => {
    const result = run(`
      function compute() {
        const read = () => value;
        let value = 1;
        return read();
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a global / unresolved reference", () => {
    const result = run(`
      function compute() {
        return window.location.href;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag an interface member name matching a later value binding", () => {
    const result = run(`
      interface Options {
        onRender?: () => void;
      }
      const onRender = () => {};
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a class field initializer referencing a later-declared class", () => {
    const result = run(`
      class Manager {
        private readonly pending = new Pending();
      }
      class Pending {}
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag interface heritage extending a later-declared type (type space)", () => {
    const result = run(`
      interface WithLength extends LengthMethods {}
      declare class LengthMethods {
        get length(): number;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag an interface index-signature parameter name", () => {
    const result = run(`
      interface TabData {
        [tabId: string]: string;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a computed interface key referencing a later const (erased type space)", () => {
    const result = run(`
      interface EditableCell {
        [ORIGINAL_INDEX_KEY]: number;
      }
      const ORIGINAL_INDEX_KEY = "__originalIndex__";
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag anything in a .d.ts declaration file", () => {
    const result = runRule(
      noUseBeforeDefine,
      `
        export interface WithGet extends GetItemMethods {}
        export declare class GetItemMethods {}
      `,
      { filename: "types.d.ts" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a const read before its declaration inside a component body (real TDZ)", () => {
    const result = run(`
      const TreeSelect = ({ properties }) => {
        const [checked, setChecked] = useState(checkedData);
        const checkedData = isArray(properties.checkedData);
        return checked;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });
});
