import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

describe("exhaustive-deps literal index dependency coverage", () => {
  it("retains only the complex-expression advice in the synthetic fuzz seed", () => {
    const code = readFileSync(
      new URL(
        "../../../../../fuzz/corpus/regressions/exhaustive-deps--literal-index-values.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((diagnostic) => diagnostic.message.includes("complex"))).toBe(
      true,
    );
  });

  it.each([
    ["a single slot", "choices[0]", "choices[0]"],
    ["several slots", "choices[0] + choices[1]", "choices[0], choices[1]"],
    ["repeated reads", "choices[0] + choices[0]", "choices[0]"],
    ["equivalent numeric spelling", "choices[0x10]", "choices[16]"],
    ["transparent wrappers", "(choices!)[0]", "(choices[0] as string)"],
  ])(
    "retains complex-expression advice without a missing root for %s",
    (_name, expression, deps) => {
      const result = runRule(
        exhaustiveDeps,
        `import { useMemo } from "react";
       const Example = ({ choices }) => useMemo(() => ${expression}, [${deps}]);`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics.every((diagnostic) => diagnostic.message.includes("complex"))).toBe(
        true,
      );
    },
  );

  it.each(["useMemo", "useCallback", "useEffect", "useLayoutEffect"])(
    "covers direct indexed value arguments in %s",
    (hookName) => {
      const result = runRule(
        exhaustiveDeps,
        `import { ${hookName} } from "react";
         const Example = ({ choices, consume }) => ${hookName}(() => {
           consume(choices[0], choices[1]);
         }, [consume, choices[0], choices[1]]);`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(2);
      expect(result.diagnostics.every((diagnostic) => diagnostic.message.includes("complex"))).toBe(
        true,
      );
    },
  );

  it("covers an owned dense array with reactive elements", () => {
    const result = runRule(
      exhaustiveDeps,
      `const Example = ({ first, second }) => {
         const choices = [first, second];
         return useMemo(() => choices[0] + choices[1], [choices[0], choices[1]]);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((diagnostic) => diagnostic.message.includes("complex"))).toBe(
      true,
    );
  });

  it("preserves independently missing captures", () => {
    const result = runRule(
      exhaustiveDeps,
      `const Example = ({ choices, prefix }) =>
         useMemo(() => prefix + choices[0], [choices[0]]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[1]?.message).toContain("stale `prefix`");
  });

  it("covers several independent roots with a single dependency pass", () => {
    const result = runRule(
      exhaustiveDeps,
      `const Example = ({ choices, alternatives }) =>
         useMemo(() => choices[0] + alternatives[1], [choices[0], alternatives[1]]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((diagnostic) => diagnostic.message.includes("complex"))).toBe(
      true,
    );
  });

  it.each([
    "arguments[0][0] = next;",
    "const supplied = arguments; supplied[0][0] = next;",
    "const write = () => { arguments[0][0] = next; }; write();",
  ])("rejects visible mutation through the implicit arguments alias: %s", (statement) => {
    const result = runRule(
      exhaustiveDeps,
      `function useChoice(choices, next) {
         const selected = useMemo(() => choices[0], [choices[0]]);
         ${statement}
         return selected;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("stale `choices`")),
    ).toBe(true);
  });

  it("rejects implicit arguments mutation of a destructured parameter", () => {
    const result = runRule(
      exhaustiveDeps,
      `function useChoice({ choices }, next) {
         const selected = useMemo(() => choices[0], [choices[0]]);
         arguments[0].choices[0] = next;
         return selected;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("stale `choices`")),
    ).toBe(true);
  });

  it("rejects inherited arguments in an arrow owner", () => {
    const result = runRule(
      exhaustiveDeps,
      `function createChoice(outerChoices, next) {
         const useChoice = (choices) => {
           arguments[0][0] = next;
           return useMemo(() => choices[0], [choices[0]]);
         };
         return useChoice(outerChoices);
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("stale `choices`")),
    ).toBe(true);
  });

  it.each(["unused", '"literal"', "opaque()", "123"])(
    "does not expose unrelated downstream reports for an extra %s dependency",
    (extraDependency) => {
      const result = runRule(
        exhaustiveDeps,
        `const Example = ({ choices, unused, opaque }) =>
           useMemo(() => choices[0], [choices[0], ${extraDependency}]);`,
      );
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message);
      expect(messages.some((message) => message.includes("can run with a stale"))).toBe(false);
      expect(messages.filter((message) => message.includes("complex"))).toHaveLength(1);
      expect(messages.some((message) => message.includes("never uses"))).toBe(false);
      expect(messages.filter((message) => message.includes("literal"))).toHaveLength(
        extraDependency === "123" ? 1 : 0,
      );
    },
  );

  it.each(["...other, choices[0]", "choices[0], ...other", ", choices[0]", "choices[0], ,"])(
    "requires the root for a dependency array with a spread or hole: %s",
    (dependencies) => {
      const result = runRule(
        exhaustiveDeps,
        `const Example = ({ choices, other }) => useMemo(() => choices[0], [${dependencies}]);`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.message.includes("stale `choices`")),
      ).toBe(true);
    },
  );

  it.each([
    ["an omitted slot", "choices[0] + choices[2]", "choices[0], choices[1]"],
    ["a root value", "choices", "choices[0]"],
    ["a dynamic index", "choices[index]", "choices[0], index"],
    ["a computed dependency", "choices[0]", "choices[index], index"],
    ["a transformed dependency", "choices[0]", "choices[0] + 1"],
    ["an optional capture", "choices?.[0]", "choices[0]"],
    ["an optional dependency", "choices[0]", "choices?.[0]"],
    ["an optional nested dependency", "choices?.[0].name", "choices?.[0]?.name"],
    ["a nested member", "choices[0].name", "choices[0]"],
    ["a member receiver", "choices[0]()", "choices[0]"],
    ["an optional member receiver", "choices[0]?.()", "choices[0]"],
    ["a constructor", "new choices[0]()", "choices[0]"],
    ["a template tag", "choices[0]`hello`", "choices[0]"],
    ["a deferred read", "() => choices[0]", "choices[0]"],
    ["a string index", 'choices["0"]', 'choices["0"]'],
    ["a negative index", "choices[-1]", "choices[-1]"],
    ["a fractional index", "choices[0.5]", "choices[0.5]"],
    ["a bigint index", "choices[0n]", "choices[0n]"],
    ["a missing dependency", "choices[0]", ""],
    ["a spread dependency", "choices[0]", "...choices"],
  ])("still requires the root for %s", (_name, expression, deps) => {
    const result = runRule(
      exhaustiveDeps,
      `const Example = ({ choices, index }) => useMemo(() => ${expression}, [${deps}]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("stale `choices")),
    ).toBe(true);
  });

  it.each([
    "choices[0] = next;",
    "choices[0] ||= next;",
    "choices[0]++;",
    "delete choices[0];",
    "[choices[0]] = incoming;",
    "({ value: choices[0] } = incoming);",
    "for (choices[0] of incoming) {}",
    "for (choices[0] in incoming) {}",
    "choices = incoming;",
    "const alias = choices; alias[0] = next;",
    "consume(choices);",
    'Object.defineProperty(choices, "0", { get: () => next });',
    'eval("choices[0] = next");',
  ])("retains the root requirement after %s", (statement) => {
    const result = runRule(
      exhaustiveDeps,
      `const Example = ({ choices, next, incoming, consume }) => {
         ${statement}
         return useMemo(() => choices[0], [choices[0]]);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("stale `choices`")),
    ).toBe(true);
  });

  it.each([
    "getChoices()",
    "new Proxy([first], {})",
    "({ get 0() { return first; } })",
    "({ 0: first })",
    "[...incoming]",
    "[, first]",
    "[]",
  ])("does not infer slot providers from %s", (initializer) => {
    const result = runRule(
      exhaustiveDeps,
      `const Example = ({ first, incoming }) => {
         const choices = ${initializer};
         return useMemo(() => choices[0], [choices[0]]);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("stale `choices`")),
    ).toBe(true);
  });

  it("preserves the existing source warning for a local root alias", () => {
    const result = runRule(
      exhaustiveDeps,
      `const Example = ({ incoming }) => {
         const choices = incoming;
         return useMemo(() => choices[0], [choices[0]]);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("stale `incoming`")),
    ).toBe(true);
  });

  it("requires the root for an absent owned slot", () => {
    const result = runRule(
      exhaustiveDeps,
      `const Example = ({ first }) => {
         const choices = [first];
         return useMemo(() => choices[1], [choices[1]]);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("stale `choices`")),
    ).toBe(true);
  });

  it.each([
    "({ choices = [] })",
    "({ ...choices })",
    "({ settings: { choices } })",
    "(choices = [])",
  ])("does not broaden the parameter provider contract to %s", (parameters) => {
    const result = runRule(
      exhaustiveDeps,
      `const Example = ${parameters} => useMemo(() => choices[0], [choices[0]]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("stale `choices`")),
    ).toBe(true);
  });

  it("does not match a dependency from a shadowed binding", () => {
    const result = runRule(
      exhaustiveDeps,
      `const Example = ({ choices }) => {
         const select = () => choices[0];
         {
           const choices = ["different"];
           return useMemo(select, [choices[0]]);
         }
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("stale `choices`")),
    ).toBe(true);
  });

  it("preserves the existing ordinary dot-member contract", () => {
    const result = runRule(
      exhaustiveDeps,
      "const Example = ({ choices }) => useMemo(() => choices.first, [choices.first]);",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
