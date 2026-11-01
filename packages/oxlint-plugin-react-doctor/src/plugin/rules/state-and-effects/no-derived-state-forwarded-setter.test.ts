import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noDerivedState } from "./no-derived-state.js";
import { noInitializeState } from "./no-initialize-state.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

for (const rule of [noDerivedState, noDerivedStateEffect]) {
  describe(`${rule.id} forwarded setters`, () => {
    it.each([
      ["a direct call", "", "setValue(source)"],
      [
        "an expression helper",
        "const assign = (setter, value) => setter(value);",
        "assign(setValue, source)",
      ],
      [
        "a block helper",
        "const assign = (setter, value) => { setter(value); };",
        "assign(setValue, source)",
      ],
      [
        "a returned call",
        "const assign = (setter, value) => { return setter(value); };",
        "assign(setValue, source)",
      ],
      [
        "a function declaration",
        "function assign(setter, value) { setter(value); }",
        "assign(setValue, source)",
      ],
      [
        "an arbitrary helper name",
        "const applyValue = (writer, nextValue) => writer(nextValue);",
        "applyValue(setValue, source)",
      ],
      [
        "reordered arguments",
        "const assign = (value, setter) => setter(value);",
        "assign(source, setValue)",
      ],
      [
        "an immutable setter alias",
        "const assign = (setter, value) => setter(value);",
        "const writeValue = setValue; assign(writeValue, source)",
      ],
      [
        "transparent TypeScript expressions",
        "const assign = (setter, value) => (setter as CallableFunction)((value as string)!);",
        "assign((setValue as CallableFunction), source)",
      ],
    ])("reports %s", (_scenario, helper, expression) => {
      const result = runRule(
        rule,
        `
        import { useState, useEffect } from "react";
        ${helper}
        const Component = ({ source }) => {
          const [value, setValue] = useState("");
          useEffect(() => { ${expression}; }, [source]);
          return value;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it.each([
      ["an imported helper", 'import { assign } from "writer";', "assign(setValue, source)"],
      ["an unknown helper", "", "assign(setValue, source)"],
      [
        "a deferred setter",
        "const assign = (setter, value) => setTimeout(() => setter(value), 0);",
        "assign(setValue, source)",
      ],
      [
        "a returned callback",
        "const assign = (setter, value) => () => setter(value);",
        "assign(setValue, source)",
      ],
      [
        "a returned setter",
        "const assign = (setter, value) => setter;",
        "assign(setValue, source)",
      ],
      [
        "a shadowed helper",
        "const assign = (setter, value) => setter(value);",
        "{ const assign = subscribe; assign(setValue, source); }",
      ],
      [
        "a mutable setter alias",
        "const assign = (setter, value) => setter(value);",
        "let writer = setValue; writer = subscribe; assign(writer, source)",
      ],
      [
        "a registered callback",
        "const assign = (setter, value) => subscribe(setter, value);",
        "assign(setValue, source)",
      ],
      [
        "an async helper",
        "const assign = async (setter, value) => setter(value);",
        "assign(setValue, source)",
      ],
      [
        "a generator helper",
        "function* assign(setter, value) { setter(value); }",
        "assign(setValue, source)",
      ],
      [
        "a conditional helper",
        "const assign = (setter, value) => { if (value) setter(value); };",
        "assign(setValue, source)",
      ],
      [
        "an optional setter call",
        "const assign = (setter, value) => setter?.(value);",
        "assign(setValue, source)",
      ],
      [
        "a replaced helper",
        "let assign = (setter, value) => setter(value); assign = subscribe;",
        "assign(setValue, source)",
      ],
      [
        "a reassigned parameter",
        "const assign = (setter, value) => { setter = subscribe; setter(value); };",
        "assign(setValue, source)",
      ],
      [
        "a subscription in a default parameter",
        "const assign = (setter, value, registration = subscribe(next => setter(next))) => setter(value);",
        "assign(setValue, source)",
      ],
      [
        "a subscription in a destructuring default",
        "const assign = (setter, value, { registration = subscribe(next => setter(next)) } = {}) => setter(value);",
        "assign(setValue, source)",
      ],
      [
        "a reassigned const helper",
        "const assign = (setter, value) => setter(value); assign = subscribe;",
        "assign(setValue, source)",
      ],
      [
        "a reassigned helper alias",
        "const assign = (setter, value) => setter(value); const forward = assign; forward = subscribe;",
        "forward(setValue, source)",
      ],
      [
        "a shadowed setter",
        "const assign = (setter, value) => { const setValue = subscribe; setValue(value); };",
        "assign(setValue, source)",
      ],
      [
        "a spread argument",
        "const assign = (ignored, setter, value) => setter(value);",
        "assign(...source, setValue, source)",
      ],
      [
        "an unreachable invocation",
        "const assign = (setter, value) => setter(value);",
        "if (false) assign(setValue, source)",
      ],
      [
        "a deferred invocation",
        "const assign = (setter, value) => setter(value);",
        "setTimeout(() => assign(setValue, source), 0)",
      ],
      [
        "an unknown result",
        "const assign = (setter, value) => setter(value);",
        "assign(setValue, readExternal(source))",
      ],
      [
        "a local hook replacement",
        "const useState = subscribe; const assign = (setter, value) => setter(value);",
        "assign(setValue, source)",
      ],
    ])("keeps %s quiet", (_scenario, helper, expression) => {
      const result = runRule(
        rule,
        `
        ${helper}
        const Component = ({ source }) => {
          const [value, setValue] = useState("");
          useEffect(() => { ${expression}; }, [source]);
          return value;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      [
        "an independent event writer",
        '<button onClick={() => assign(setValue, "edited")}>{value}</button>',
      ],
      ["a returned state setter", "[value, setValue]"],
    ])("preserves %s", (_scenario, returnedExpression) => {
      const result = runRule(
        rule,
        `
        const assign = (setter, value) => setter(value);
        const Component = ({ source }) => {
          const [value, setValue] = useState("");
          useEffect(() => { assign(setValue, source); }, [source]);
          return ${returnedExpression};
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("preserves an event writer through a setter alias", () => {
      const result = runRule(
        rule,
        `
        const assign = (setter, value) => setter(value);
        const Component = ({ source }) => {
          const [value, setValue] = useState("");
          const writer = setValue;
          useEffect(() => { assign(writer, source); }, [source]);
          return <button onClick={() => writer("edited")}>{value}</button>;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      ["a direct write", "setValue(source)"],
      ["the original setter", "assign(setValue, source)"],
      ["a one-hop alias", "assign(writerOne, source)"],
      ["a two-hop alias", "assign(writerTwo, source)"],
    ])("preserves downstream event writers with %s", (_scenario, expression) => {
      for (const eventWriter of ["writerOne", "writerTwo"]) {
        const result = runRule(
          rule,
          `
          import { useState, useEffect } from "react";
          const assign = (setter, value) => setter(value);
          const Component = ({ source }) => {
            const [value, setValue] = useState("");
            const writerOne = setValue;
            const writerTwo = writerOne;
            useEffect(() => { ${expression}; }, [source]);
            return <button onClick={() => ${eventWriter}("edited")}>{value}</button>;
          };
        `,
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      }
    });

    it.each([
      ["a direct write", "setValue(source)"],
      ["the original setter", "assign(setValue, source)"],
      ["a one-hop alias", "assign(writerOne, source)"],
      ["a two-hop alias", "assign(writerTwo, source)"],
    ])("reports readonly alias families with %s", (_scenario, expression) => {
      const result = runRule(
        rule,
        `
        import { useState, useEffect } from "react";
        const assign = (setter, value) => setter(value);
        const Component = ({ source }) => {
          const [value, setValue] = useState("");
          const writerOne = setValue;
          const writerTwo = writerOne;
          useEffect(() => { ${expression}; }, [source, setValue, writerOne, writerTwo]);
          return value;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it.each([
      ["a mutable alias", "let writer = setValue; writer = subscribe;"],
      ["an unknown escape", "const writer = setValue; register(writer);"],
      ["a stored setter", "const holder = { writer: setValue };"],
      ["a reassigned const alias", "const writer = setValue; writer = subscribe;"],
    ])("withholds forwarded diagnostics for %s", (_scenario, declarations) => {
      const result = runRule(
        rule,
        `
        import { useState, useEffect } from "react";
        const assign = (setter, value) => setter(value);
        const Component = ({ source }) => {
          const [value, setValue] = useState("");
          ${declarations}
          useEffect(() => { assign(setValue, source); }, [source]);
          return value;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("distinguishes a shadowed event alias from the setter family", () => {
      const result = runRule(
        rule,
        `
        import { useState, useEffect } from "react";
        const assign = (setter, value) => setter(value);
        const Component = ({ source }) => {
          const [value, setValue] = useState("");
          const writerOne = setValue;
          const writerTwo = writerOne;
          useEffect(() => { assign(setValue, source); }, [source]);
          return <button onClick={() => {
            const writerTwo = subscribe;
            writerTwo("edited");
          }}>{value}</button>;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("resolves aliased React imports", () => {
      const result = runRule(
        rule,
        `
        import { useState as useValue, useEffect as useSync } from "react";
        const assign = (setter, value) => setter(value);
        const Component = ({ source }) => {
          const [value, setValue] = useValue("");
          useSync(() => { assign(setValue, source); }, [source]);
          return value;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("distinguishes two invocations of one helper", () => {
      const result = runRule(
        rule,
        `
        const assign = (setter, value) => setter(value);
        const Component = ({ source }) => {
          const [value, setValue] = useState("");
          useEffect(() => {
            assign(subscribe, source);
            assign(setValue, source);
          }, [source]);
          return value;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });
}

describe("forwarded setter initializer equivalence", () => {
  it.each([
    ["an existing initial value", "source", 0],
    ["a missing initial value", '""', 1],
  ])("preserves %s", (_scenario, initializer, diagnosticCount) => {
    const result = runRule(
      noInitializeState,
      `
      const assign = (setter, value) => setter(value);
      const Component = ({ source }) => {
        const [value, setValue] = useState(${initializer});
        useEffect(() => { assign(setValue, source); }, []);
        return value;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });
});

describe("setter alias evidence for editable-state resets", () => {
  it("retains a direct reset fact with downstream event writers", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `
      import { useState, useEffect } from "react";
      const Component = ({ recordId }) => {
        const [value, setValue] = useState("");
        const writerOne = setValue;
        const writerTwo = writerOne;
        useEffect(() => { setValue(""); }, [recordId]);
        return <input value={value} onChange={(event) => writerTwo(event.target.value)} />;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
