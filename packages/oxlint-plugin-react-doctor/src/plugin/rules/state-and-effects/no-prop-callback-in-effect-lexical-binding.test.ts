import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropCallbackInEffect } from "./no-prop-callback-in-effect.js";

const createSource = (effect: string, setup = "", props = "{ onChange }") => `
  import { useEffect, useEffectEvent, useRef, useState } from "react";
  function Widget(${props}) {
    const [count] = useState(0);
    ${setup}
    useEffect(() => { ${effect} }, [count]);
    return null;
  }
`;

describe("parent callbacks in effects use the lexical binding", () => {
  it.each([
    ["local variable", createSource("const onChange = (value) => record(value); onChange(count);")],
    [
      "local function",
      createSource("function onChange(value) { record(value); } onChange(count);"),
    ],
    ["block-local callback", createSource("{ const onChange = record; onChange(count); }")],
    [
      "renamed and shadowed prop",
      createSource("const notify = record; notify(count);", "", "{ onChange: notify }"),
    ],
    [
      "shadowed callback in a transparent wrapper",
      `import { useEffect, useEffectEvent, useState } from "react";
        function Widget({ onChange }) {
          const [count] = useState(0);
          {
            const onChange = record;
            const notify = useEffectEvent(onChange);
            useEffect(() => notify(count), [count]);
          }
          return null;
        }`,
    ],
  ])("keeps %s quiet", (_name, source) => {
    const result = runRule(noPropCallbackInEffect, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["direct prop", createSource("onChange(count);")],
    ["renamed prop", createSource("notify(count);", "", "{ onChange: notify }")],
    ["bound alias", createSource("notify(count);", "const notify = onChange;")],
    [
      "ref-held prop",
      createSource("callback.current(count);", "const callback = useRef(onChange);"),
    ],
    [
      "transparent wrapper around the prop",
      createSource("notify(count);", "const notify = useEffectEvent(onChange);"),
    ],
    [
      "parent call next to a local shadow",
      createSource(
        "{ const onChange = record; onChange(count); } notify(count);",
        "const notify = onChange;",
      ),
    ],
  ])("still reports a %s", (_name, source) => {
    const result = runRule(noPropCallbackInEffect, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('"onChange"');
  });
});
