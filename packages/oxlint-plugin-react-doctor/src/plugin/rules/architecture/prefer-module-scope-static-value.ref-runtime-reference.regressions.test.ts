import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { containsNativeRefInitializer } from "../../utils/contains-native-ref-initializer.js";
import { containsImportedValueCall } from "../../utils/contains-imported-value-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferModuleScopeStaticValue } from "./prefer-module-scope-static-value.js";

const source =
  '// rule: prefer-module-scope-static-value\n// verdict: pass\n// weakness: library-idiom\n// source: independently synthetic native Hook initializer\nimport { useRef } from "react";\n\nexport const RefSlots = () => {\n  const slots = { primary: useRef<HTMLDivElement>(null) };\n  return <div ref={slots.primary} />;\n};\n';
const options = {
  filename: "/project/src/view.tsx",
  forceJsx: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      rootDirectory: "/project",
      framework: "vite",
      capabilities: ["react", "nextjs", "r3f", "react-native"],
    },
    react: { version: "19.0.0" },
  },
};

describe("runtime imported provider reference attribution", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 0 },
    {
      name: "useRef-direct",
      prefix: "const rewriteProvider=()=>{ mutate(useRef);}; rewriteProvider();",
      expected: 0,
      expectedNativeRefInitializer: false,
    },
    {
      name: "useRef-interface",
      prefix: "const rewriteProvider=()=>{interface useRef {} mutate(useRef);}; rewriteProvider();",
      expected: 0,
      expectedNativeRefInitializer: false,
    },
    {
      name: "useRef-typealias",
      prefix:
        "const rewriteProvider=()=>{type useRef=unknown; mutate(useRef);}; rewriteProvider();",
      expected: 0,
      expectedNativeRefInitializer: false,
    },
  ])("preserves runtime exposure: $name", (testCase) => {
    const { prefix, expected } = testCase;
    const result = runRule(preferModuleScopeStaticValue, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
    if ("expectedNativeRefInitializer" in testCase) {
      const parsed = parseFixture(prefix + "\n" + source, options);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      let checkedInitializers = 0;
      walkAst(parsed.program, (node) => {
        if (
          !isNodeOfType(node, "VariableDeclarator") ||
          !isNodeOfType(node.id, "Identifier") ||
          (node.id.name !== "slots" && node.id.name !== "labels") ||
          !node.init
        )
          return;
        expect(containsNativeRefInitializer(node.init, scopes)).toBe(
          testCase.expectedNativeRefInitializer,
        );
        expect(containsImportedValueCall(node.init, scopes)).toBe(true);
        checkedInitializers++;
      });
      expect(checkedInitializers).toBe(1);
    }
  });
});
