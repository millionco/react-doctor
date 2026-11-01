import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { TEXT_RETAINED_KEY_COUNT } from "./utils/primitive-text-leaf/constants.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

interface PrimitiveTextLeafLocation {
  readonly line: number;
  readonly column: number;
}

interface PrimitiveTextLeafCase {
  readonly name: string;
  readonly code: string;
  readonly options: RunRuleOptions;
  readonly expectedLocations: ReadonlyArray<PrimitiveTextLeafLocation>;
}

const cases: ReadonlyArray<PrimitiveTextLeafCase> = [
  {
    name: "closed-match-helpers-and-bare-styled-host",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/closed-match-helpers-and-bare-styled-host.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
    ],
  },
  {
    name: "same-primitive-chain-native-leaf",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <span key={idx}>{token}</span>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/same-primitive-chain-native-leaf.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
    ],
  },
  {
    name: "literal-input-not-typed-prop",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks("abcdefghijkl").map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/literal-input-not-typed-prop.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
    ],
  },
  {
    name: "readonly-const-helper-arrows",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nconst readPairs = (input: string): string[] => input.match(/.{1,2}/g) ?? [];\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/readonly-const-helper-arrows.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "aliased-default-value-import-spelling",
    code: 'import React from "react";\nimport makeStyled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = makeStyled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/aliased-default-value-import-spelling.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
    ],
  },
  {
    name: "different-positive-finite-chunk-width",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,6}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/different-positive-finite-chunk-width.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
    ],
  },
  {
    name: "stateful-custom-styled-target",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Stateful = ({ children }) => <input defaultValue={children}/>;\nconst Glyph = styled(Stateful)``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/stateful-custom-styled-target.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "attrs-can-replace-host",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span.attrs({ as: "input" })``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/attrs-can-replace-host.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "explicit-as-polymorphism",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx} as="input">{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/explicit-as-polymorphism.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "selected-handler-attribute",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx} onClick={() => consumeToken(token)}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/selected-handler-attribute.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "selected-ref-attribute",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx} ref={captureNode}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/selected-ref-attribute.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "selected-opaque-prop-spread",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx} {...attributes}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/selected-opaque-prop-spread.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "stateful-selected-descendant",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}><input defaultValue={token}/></Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/stateful-selected-descendant.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "styled-provider-visible-method-write",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nstyled.span = alternateFactory;\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/styled-provider-visible-method-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "styled-provider-transport",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\ninspectProvider(styled);\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/styled-provider-transport.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "helper-reassignment",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nreadPairs = replacement;\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/helper-reassignment.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "helper-opaque-escape",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\ninspectFunction(readPairs);\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/helper-opaque-escape.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "map-helper-default-parameter",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string, extra = opaque()): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/map-helper-default-parameter.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "non-global-regexp-is-outside-v1",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/non-global-regexp-is-outside-v1.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "capturing-regexp-is-outside-v1",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/(.{1,2})/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/capturing-regexp-is-outside-v1.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "custom-match-input-object",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks({ match: () => [<input/>] } as any).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/custom-match-input-object.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "visible-string-match-replacement",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nString.prototype.match = replacement;\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/visible-string-match-replacement.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "visible-regexp-exec-replacement",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nRegExp.prototype.exec = replacement;\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/visible-regexp-exec-replacement.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "third-callback-array-mutation",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx, values) => { values[0] = <input/>; return <Glyph key={idx}>{token}</Glyph>; })}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/third-callback-array-mutation.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 138,
      },
    ],
  },
  {
    name: "captured-component-input-write",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const resetInput = () => { source = unknownValue; };\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/captured-component-input-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "type-only-styled-provider",
    code: 'import React from "react";\nimport type styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/type-only-styled-provider.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "computed-reflection-selector",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst reflectionKey = "constructor";\nconst reflection = (() => {})[reflectionKey];\nvoid reflection;\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/computed-reflection-selector.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 12,
        column: 53,
      },
      {
        line: 12,
        column: 99,
      },
    ],
  },
  {
    name: "actual-custom-jsx-pragma",
    code: '/** @jsx alternativeElement */\nimport React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/actual-custom-jsx-pragma.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "nonempty-static-styled-template",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span`color: blue;`;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/nonempty-static-styled-template.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "explicit-pure-preact-profile",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/explicit-pure-preact-profile.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "pure-preact"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: "10.0.0",
          preactMajorVersion: 10,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "helper-extra-executable-body",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { observeInput(input); return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/helper-extra-executable-body.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "local-styled-lookalike",
    code: 'import React from "react";\nconst styled = { span: () => ({}) };\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/local-styled-lookalike.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "secondary-named-default-styled-provider-write",
    code: 'import React from "react";\nimport styled from "styled-components";\nimport { default as secondStyled } from "styled-components";\nsecondStyled.span = replacementFactory;\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-secondary-named-default-styled-provider-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 11,
        column: 53,
      },
      {
        line: 11,
        column: 99,
      },
    ],
  },
  {
    name: "visible-react-element-factory-replacement",
    code: 'import React from "react";\nimport styled from "styled-components";\nReact.createElement = replacementElementFactory;\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-visible-react-element-factory-replacement.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "logical-function-unresolved-native-provider-channel",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst selector = true ? "constructor" : "constructor";\nconst makeSource = (false || (() => {}))[selector];\nmakeSource("String.prototype.match = () => [\'changed\']")();\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-logical-function-unresolved-native-provider-channel.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 12,
        column: 53,
      },
      {
        line: 12,
        column: 99,
      },
    ],
  },
  {
    name: "dollar-as-polymorphic-styled-host",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx} $as="input">{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/independent-dollar-as-polymorphic-styled-host.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "selected-array-opaque-transport",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  inspectGroups(groups);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/selected-array-opaque-transport.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "selected-host-default-props-write",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nGlyph.defaultProps = { as: "input" };\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/selected-host-default-props-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "type-only-react-provider",
    code: 'import type React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/type-only-react-provider.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "native-array-provider-write",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nArray.prototype.map = replacement;\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/native-array-provider-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 10,
        column: 53,
      },
      {
        line: 10,
        column: 99,
      },
    ],
  },
  {
    name: "unknown-computed-destructured-selector",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst { [selector]: carrier } = (() => {});\nvoid carrier;\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/unknown-computed-destructured-selector.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 11,
        column: 53,
      },
      {
        line: 11,
        column: 99,
      },
    ],
  },
  {
    name: "helper-export-transport",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nexport function readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/helper-export-transport.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "async-chunk-helper",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nasync function readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/async-chunk-helper.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "nonempty-nullish-match-fallback",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? ["fallback"]; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/nonempty-nullish-match-fallback.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "native-workspace-profile-outside-contract",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/native-workspace-profile-outside-contract.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: true,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "react-compiler-profile-outside-contract",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/react-compiler-profile-outside-contract.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: true,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "global-require-react-provider-write",
    code: 'import React from "react";\nimport styled from "styled-components";\nconst ReactModule = require("react");\nReactModule.createElement = replacementElementFactory;\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename: "/synthetic/byte-text-slices/independent-global-require-react-provider-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 11,
        column: 53,
      },
      {
        line: 11,
        column: 99,
      },
    ],
  },
  {
    name: "global-module-require-react-provider-write",
    code: 'import React from "react";\nimport styled from "styled-components";\nconst ReactModule = module.require("react");\nReactModule.createElement = replacementElementFactory;\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-global-module-require-react-provider-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 11,
        column: 53,
      },
      {
        line: 11,
        column: 99,
      },
    ],
  },
  {
    name: "node-module-named-create-require-provider-write",
    code: 'import React from "react";\nimport styled from "styled-components";\nimport { createRequire as makeLoader } from "node:module";\nconst load = makeLoader(import.meta.url);\nconst ReactModule = load("react");\nReactModule.createElement = replacementElementFactory;\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-node-module-named-create-require-provider-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 13,
        column: 53,
      },
      {
        line: 13,
        column: 99,
      },
    ],
  },
  {
    name: "module-namespace-create-require-provider-write",
    code: 'import React from "react";\nimport styled from "styled-components";\nimport * as loaderModule from "module";\nconst load = loaderModule.createRequire(import.meta.url);\nconst ReactModule = load("react");\nReactModule.createElement = replacementElementFactory;\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-module-namespace-create-require-provider-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 13,
        column: 53,
      },
      {
        line: 13,
        column: 99,
      },
    ],
  },
  {
    name: "process-builtin-module-create-require-provider-write",
    code: 'import React from "react";\nimport styled from "styled-components";\nconst load = process.getBuiltinModule("module").createRequire(import.meta.url);\nconst ReactModule = load("react");\nReactModule.createElement = replacementElementFactory;\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-process-builtin-module-create-require-provider-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 12,
        column: 53,
      },
      {
        line: 12,
        column: 99,
      },
    ],
  },
  {
    name: "erased-interface-global-function-provider-write",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface Function {}\nFunction("String.prototype.match = () => [\'changed\']")();\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-erased-interface-global-function-provider-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 11,
        column: 53,
      },
      {
        line: 11,
        column: 99,
      },
    ],
  },
  {
    name: "pure-preact-capability-without-version-metadata",
    code: 'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-pure-preact-capability-without-version-metadata.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "pure-preact"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 9,
        column: 53,
      },
      {
        line: 9,
        column: 99,
      },
    ],
  },
  {
    name: "canonical-process-namespace-react-provider-write",
    code: 'import React from "react";\nimport styled from "styled-components";\nimport * as runtime from "node:process";\nconst loader = runtime.getBuiltinModule("module").createRequire("/synthetic/provider-entry.cjs");\nconst ReactModule = loader("react");\nReactModule.createElement = () => null;\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-canonical-process-namespace-react-provider-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 13,
        column: 53,
      },
      {
        line: 13,
        column: 99,
      },
    ],
  },
  {
    name: "canonical-process-named-loader-react-provider-write",
    code: 'import React from "react";\nimport styled from "styled-components";\nimport { getBuiltinModule as loadBuiltin } from "process";\nconst loader = loadBuiltin("module").createRequire("/synthetic/provider-entry.cjs");\nconst ReactModule = loader("react");\nReactModule.createElement = () => null;\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-canonical-process-named-loader-react-provider-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 13,
        column: 53,
      },
      {
        line: 13,
        column: 99,
      },
    ],
  },
  {
    name: "canonical-vm-namespace-native-string-match-write",
    code: 'import React from "react";\nimport styled from "styled-components";\nimport * as runtime from "node:vm";\nruntime.runInThisContext("String.prototype.match = () => [\'synthetic\'];");\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <Glyph key={idx}>{token}</Glyph>)}</div>)}</section>;\n};\n',
    options: {
      filename:
        "/synthetic/byte-text-slices/independent-canonical-vm-namespace-native-string-match-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "17.0.1",
          reactMajorVersion: 17,
          styledComponentsVersion: "5.3.3",
          framework: "unknown",
          hasReactCompiler: false,
          hasReactNativeWorkspace: false,
          preactVersion: null,
          preactMajorVersion: null,
        },
      },
    },
    expectedLocations: [
      {
        line: 11,
        column: 53,
      },
      {
        line: 11,
        column: 99,
      },
    ],
  },
];

describe("closed primitive text leaf index keys", () => {
  it.each(cases)("$name", ({ code, options, expectedLocations }) => {
    const result = runRule(noArrayIndexAsKey, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map(({ line, column }) => ({ line, column }))).toEqual(
      expectedLocations,
    );
  });

  it("uses the original wrapped host source for the selected inner leaf", () => {
    const [sample] = cases;
    expect(sample).toBeDefined();
    if (!sample) return;
    const result = runRule(wrapWithSemanticContext(noArrayIndexAsKey), sample.code, sample.options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map(({ line, column }) => ({ line, column }))).toEqual(
      sample.expectedLocations,
    );
  });

  it("retains both keys under a custom wrapped host JSX factory", () => {
    const [sample] = cases;
    if (!sample) return;
    const result = runRule(
      wrapWithSemanticContext(noArrayIndexAsKey),
      "/** @jsx customElement */\n" + sample.code,
      sample.options,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(TEXT_RETAINED_KEY_COUNT);
  });

  it("retains both keys when complete host source is absent", () => {
    const [sample] = cases;
    if (!sample) return;
    const rule = {
      ...noArrayIndexAsKey,
      create: (context: RuleContext) =>
        noArrayIndexAsKey.create({ ...context, sourceCode: undefined }),
    };
    const result = runRule(rule, sample.code, sample.options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(TEXT_RETAINED_KEY_COUNT);
  });

  it("retains both keys when the complete host source accessor throws", () => {
    const [sample] = cases;
    if (!sample) return;
    const rule = {
      ...noArrayIndexAsKey,
      create: (context: RuleContext) =>
        noArrayIndexAsKey.create({
          ...context,
          sourceCode: {
            getText: () => {
              throw new Error("Source unavailable");
            },
          },
        }),
    };
    const result = runRule(rule, sample.code, sample.options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(TEXT_RETAINED_KEY_COUNT);
  });
});
