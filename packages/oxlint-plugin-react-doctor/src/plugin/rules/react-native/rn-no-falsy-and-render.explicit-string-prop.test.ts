import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { rnNoFalsyAndRender } from "./rn-no-falsy-and-render.js";

interface ExplicitStringPropCase {
  name: string;
  code: string;
  expectedCount: number;
}

const commonOptions: RunRuleOptions = {
  filename: "src/explicit-string-native-prop.tsx",
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
    },
  },
  includeLocations: true,
  forceJsx: false,
};

const cases: ReadonlyArray<ExplicitStringPropCase> = [
  {
    name: "optional-local-interface-string",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate?: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 0,
  },
  {
    name: "required-local-interface-string",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 0,
  },
  {
    name: "inline-object-string",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\nexport const Card = forwardRef<View, { rate?: string }>(({ rate }: { rate?: string }, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 0,
  },
  {
    name: "renamed-string-prop-binding",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { caption: string; }\nexport const Card = forwardRef<View, CardProps>(({ caption: rate }: CardProps, ref) => {\n  return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 0,
  },
  {
    name: "own-string-property-with-opaque-extends",
    code: 'import React, { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps extends React.ComponentProps<typeof View> { rate?: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 0,
  },
  {
    name: "numeric-prop-retains-warning",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate?: number; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 1,
  },
  {
    name: "untyped-prop-retains-warning",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\nexport const Card = forwardRef(({ rate }, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "mixed-string-number-retains-warning",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string | number; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 1,
  },
  {
    name: "unknown-prop-retains-warning",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: unknown; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 1,
  },
  {
    name: "any-prop-retains-warning",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: any; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 1,
  },
  {
    name: "direct-parameter-write-retains-warning",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  rate = 0; return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 1,
  },
  {
    name: "pattern-parameter-write-retains-warning",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  [rate] = [0]; return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 1,
  },
  {
    name: "loop-parameter-write-retains-warning",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  for (rate of [0]) {} return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 1,
  },
  {
    name: "shadowed-numeric-callback-retains-warning",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  const Inner = (rate: number) => <View>{rate && <Text>Rated</Text>}</View>; return <Inner rate={0} />;\n});\n',
    expectedCount: 1,
  },
  {
    name: "imported-interface-is-opaque",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\nimport type { CardProps } from "./opaque-props";\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "selected-default-is-unsupported",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate?: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate = 0 }: CardProps, ref) => {\n  return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 1,
  },
  {
    name: "typed-member-is-unsupported",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>((props: CardProps, ref) => <View>{props.rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "named-string-type-alias-is-unsupported",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ntype Caption = string;\ninterface CardProps { rate: Caption; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 1,
  },
  {
    name: "runtime-enum-owner-abstention",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  enum Step { Ready = 0 } void Step; return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 1,
  },
  {
    name: "eval-reference-owner-abstention",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  void eval; return <View>{rate && <Text>Rated</Text>}</View>;\n});\n',
    expectedCount: 1,
  },
  {
    name: "type-only-react-declaration",
    code: 'import type { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "type-only-react-specifier",
    code: 'import { type forwardRef, useState } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "mutated-forward-ref-provider",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nforwardRef = replacement;\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "namespace-forward-ref-value",
    code: 'import * as React from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = React.forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 0,
  },
  {
    name: "namespace-provider-write",
    code: 'import * as React from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nReact.forwardRef = replacement;\nexport const Card = React.forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "duplicate-selected-property",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; rate: number; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "merged-interface-declarations",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\ninterface CardProps { other: number; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "callback-body-interface-does-not-shadow-signature",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => { interface CardProps { rate: number; } return <View>{rate && <Text>Rated</Text>}</View>; });\n',
    expectedCount: 0,
  },
  {
    name: "enclosing-value-name-competes-with-interface",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nconst CardProps = runtimeValue;\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "computed-destructured-property",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ ["rate"]: rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "computed-interface-property",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { ["rate"]: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "nested-destructured-property",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { row: { rate: string }; }\nexport const Card = forwardRef<View, CardProps>(({ row: { rate } }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "closure-assignment-retains-warning",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => { const reset = () => { rate = 0; }; reset(); return <View>{rate && <Text>Rated</Text>}</View>; });\n',
    expectedCount: 1,
  },
  {
    name: "shadowed-forward-ref-provider",
    code: 'const forwardRef = (callback) => callback;\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "type-query-is-erased",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => { let selected: typeof rate; return <View>{rate && <Text>Rated</Text>}</View>; });\n',
    expectedCount: 0,
  },
  {
    name: "numeric-shadow-inside-string-signature",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => { { const rate = 0; return <View>{rate && <Text>Rated</Text>}</View>; } });\n',
    expectedCount: 1,
  },
  {
    name: "non-forward-ref-string-component-unsupported",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = ({ rate }: CardProps) => <View>{rate && <Text>Rated</Text>}</View>;\n',
    expectedCount: 1,
  },
  {
    name: "selected-string-default-unsupported",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate = "rated" }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "parameter-property-runtime-owner",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => { class Holder { constructor(public value: string) {} } return <View>{rate && <Text>Rated</Text>}</View>; });\n',
    expectedCount: 1,
  },
  {
    name: "unused-boolean-control-still-quiet",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\nexport const Card = () => <View>{true && <Text>Rated</Text>}</View>;\n',
    expectedCount: 0,
  },
  {
    name: "block-interface-is-not-signature-type",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate: number; }\nexport const Factory = () => { { interface CardProps { rate: string; } } return forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>); };\n',
    expectedCount: 1,
  },
  {
    name: "secondary-react-namespace-write",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\nimport * as OtherReact from "react";\ninterface CardProps { rate: string; }\nOtherReact.forwardRef = replacement;\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "secondary-react-default-escape",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\nimport OtherReact from "react";\ninterface CardProps { rate: string; }\nconst escapedReact = OtherReact; void escapedReact;\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "named-default-react-provider-write",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\nimport { default as OtherReact } from "react";\ninterface CardProps { rate: string; }\nOtherReact.forwardRef = replacement;\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "default-react-erased-props-type",
    code: 'import React, { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps extends React.ComponentProps<typeof View> { rate?: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 0,
  },
  {
    name: "module-runtime-enum-profile-abstention",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\nenum Stage { Ready = 0 }\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "module-eval-read-profile-abstention",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\nvoid eval;\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 1,
  },
  {
    name: "unused-secondary-react-providers",
    code: 'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\nimport OtherReact from "react";\nimport * as OtherReactNamespace from "react";\nimport { useState } from "react";\nvoid useState;\ninterface CardProps { rate: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => <View>{rate && <Text>Rated</Text>}</View>);\n',
    expectedCount: 0,
  },
];

describe("rn-no-falsy-and-render explicit string prop", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(rnNoFalsyAndRender, code, commonOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
