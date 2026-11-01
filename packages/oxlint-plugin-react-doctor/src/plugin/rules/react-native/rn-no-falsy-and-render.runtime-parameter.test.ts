import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoFalsyAndRender } from "./rn-no-falsy-and-render.js";
const source =
  'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate?: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n\n  return <View>{rate && <Text>Rated</Text>}</View>;\n});\n';
const cases = [
  { name: "plain", statement: "", expected: 0 },
  { name: "interface", statement: "interface rate {}", expected: 0 },
  { name: "type-alias", statement: "type rate=unknown;", expected: 0 },
  { name: "interface-assigned", statement: "interface rate {} rate=0;", expected: 1 },
  {
    name: "interface-string-assigned",
    statement: "interface rate {} rate='changed';",
    expected: 1,
  },
  { name: "nested-interface-assigned", statement: "{interface rate {} rate=0;}", expected: 1 },
  { name: "nested-local-assigned", statement: "{let rate=0;rate++;}", expected: 0 },
  {
    name: "nested-parameter-assigned",
    statement: "const update=(rate:number)=>{rate++;};",
    expected: 0,
  },
  {
    name: "nested-erased-closure-assigned",
    statement: "const update=()=>{interface rate {} rate=0;};",
    expected: 1,
  },
  {
    name: "interface-with-local-shadow",
    statement: "interface rate {} {let rate=0;rate++;}",
    expected: 0,
  },
];
describe("native string runtime parameter identity", () => {
  it.each(cases)("$name", ({ statement, expected }) => {
    const result = runRule(
      rnNoFalsyAndRender,
      source.replace("  return <View>", statement + "\n  return <View>"),
      { filename: "native.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(expected);
  });
});

describe("native string merged provider identity", () => {
  it.each([
    { namespace: false, statement: "interface forwardRef {}", expected: 0 },
    { namespace: false, statement: "type forwardRef=unknown;", expected: 0 },
    { namespace: false, statement: "interface forwardRef {} expose(forwardRef);", expected: 1 },
    {
      namespace: false,
      statement: "const expose=()=>{interface forwardRef {} opaque(forwardRef);};",
      expected: 1,
    },
    { namespace: true, statement: "interface React {}", expected: 0 },
    { namespace: true, statement: "type React=unknown;", expected: 0 },
    { namespace: true, statement: "interface React {} expose(React);", expected: 1 },
    {
      namespace: true,
      statement: "const expose=()=>{interface React {} opaque(React);};",
      expected: 1,
    },
  ])("preserves provider exposure with $statement", ({ namespace, statement, expected }) => {
    const providerSource = namespace
      ? source
          .replace('import { forwardRef } from "react";', 'import React from "react";')
          .replace("= forwardRef<", "= React.forwardRef<")
      : source;
    const code = providerSource.replace(
      "import { View, Text }",
      statement + "\nimport { View, Text }",
    );
    const result = runRule(rnNoFalsyAndRender, code, { filename: "native.tsx" });
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
