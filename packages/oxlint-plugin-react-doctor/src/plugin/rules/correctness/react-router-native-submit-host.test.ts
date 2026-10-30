import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { EMPTY_RULE_VISITORS } from "../../utils/empty-rule-visitors.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { parseSourceText } from "../../utils/parse-source-file.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { jsxCurlyBracePresence } from "../react-builtins/jsx-curly-brace-presence.js";
import { reactRouterNoNavigateInRender } from "./react-router-no-navigate-in-render.js";

const source = `import { useNavigate } from "react-router-dom";
export const SignIn = () => {
  const navigate = useNavigate();
  const SUBMIT_SESSION = async () => { await Promise.resolve(); navigate("/account"); };
  const submit = (event: { preventDefault: () => void }) => { event.preventDefault(); SUBMIT_SESSION(); };
  return <form onSubmit={submit}><button type="submit">Continue</button></form>;
};`;

const options = {
  filename: "src/native-submit-helper/wrapped-host.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      capabilities: ["react", "react-router"],
    },
  },
};

describe("native submit helper host context", () => {
  it("admits a native submit helper through the production semantic wrapper", () => {
    const result = runRule(wrapWithSemanticContext(reactRouterNoNavigateInRender), source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains a custom JSX pragma warning through the production semantic wrapper", () => {
    const result = runRule(
      wrapWithSemanticContext(reactRouterNoNavigateInRender),
      `/** @jsx customElement */\n${source}`,
      options,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("forwards the source object and preserves getText receiver and node arguments", () => {
    const program = parseSourceText({ filename: "source.js", sourceText: "const value = 1;" });
    if (program === null) throw new Error("Expected parsed source");
    const sourceCode = {
      ast: program,
      getText(node?: EsTreeNode | null) {
        expect(this).toBe(sourceCode);
        return node === program ? "selected source" : "whole source";
      },
    };
    const rule: Rule = {
      id: "source-code-forwarding",
      severity: "error",
      create: (context) => {
        expect(context.sourceCode).toBe(sourceCode);
        expect(context.sourceCode?.getText?.()).toBe("whole source");
        expect(context.sourceCode?.getText?.(program)).toBe("selected source");
        return EMPTY_RULE_VISITORS;
      },
    };
    wrapWithSemanticContext(rule).create({ report: () => {}, sourceCode });
  });
});

describe("semantic wrapper source consumers", () => {
  it("curly-plain-literal-active", () => {
    const result = runRule(
      wrapWithSemanticContext(jsxCurlyBracePresence),
      'export const Example = () => <div>{"plain"}</div>;',
      { filename: "src/native-submit/source-compat.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("curly-unicode-source-escape-preserved", () => {
    const result = runRule(
      wrapWithSemanticContext(jsxCurlyBracePresence),
      'export const Example = () => <div>{"Hello \\u1026 world"}</div>;',
      { filename: "src/native-submit/source-compat.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("curly-node-text-comment-is-local", () => {
    const result = runRule(
      wrapWithSemanticContext(jsxCurlyBracePresence),
      'export const Example = () => <><div>{/* preserve this literal */"commented"}</div><span>{"plain"}</span></>;',
      { filename: "src/native-submit/source-compat.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
