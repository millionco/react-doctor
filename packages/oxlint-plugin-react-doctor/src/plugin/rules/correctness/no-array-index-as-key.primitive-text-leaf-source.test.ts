import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";
import { TEXT_RETAINED_KEY_COUNT } from "./utils/primitive-text-leaf/constants.js";

const source =
  'import React from "react";\nimport styled from "styled-components";\ninterface TextChunksProps { source: string }\nconst Glyph = styled.span``;\nfunction readChunks(input: string): string[] { return input.match(/.{1,8}/g) ?? []; }\nfunction readPairs(input: string): string[] { return input.match(/.{1,2}/g) ?? []; }\nexport const TextChunks = ({ source }: TextChunksProps) => {\n  const groups = readChunks(source).map(readPairs);\n  return <section>{groups.map((group, index) => <div key={index}>{group.map((token, idx) => <span key={idx}>{token}</span>)}</div>)}</section>;\n};\n';
const options = {
  filename: "primitive-text-leaf.tsx",
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
};

describe("primitive text leaf source comments", () => {
  it("preserves the native leaf under an inert pragma string", () => {
    const baseline = runRule(noArrayIndexAsKey, source, options);
    const result = runRule(
      noArrayIndexAsKey,
      'const label="@jsx customElement";void label;\n' + source,
      options,
    );
    expect(baseline.parseErrors).toEqual([]);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      baseline.diagnostics.map((diagnostic) => diagnostic.message),
    );
  });

  it("retains both keys under an actual pragma comment", () => {
    const result = runRule(noArrayIndexAsKey, "/** @jsx customElement */\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(TEXT_RETAINED_KEY_COUNT);
  });
});
