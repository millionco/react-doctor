import { describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import * as astTraversal from "../../utils/walk-ast.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { regionHasAccessibleName } from "./region-has-accessible-name.js";

describe("region-has-accessible-name", () => {
  it.each([
    '<div role="region" />',
    '<section role="region" />',
    '<article role="region" />',
    '<aside role="region" />',
    '<main role="region" />',
    '<nav role="region" />',
    '<header role="region" />',
    '<footer role="region" />',
    '<div role={"region"} />',
    '<section role="region"><h2>Overview</h2><p>Content</p></section>',
    '<div><section role="region" /></div>',
    '<><section role="region" /></>',
    '<div role="region" style={{display: expanded ? "block" : "none"}} />',
    'const View = () => <>{active && <section role="region" />}</>;',
    'const View = () => <>{true && <section role="region" />}</>;',
    'const View = () => <>{false || <section role="region" />}</>;',
  ])("reports unnamed explicit containers (%s)", (code) => {
    const result = runRule(regionHasAccessibleName, code);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    "<section />",
    '<div role="group" />',
    "<div role={role} />",
    '<div role="region main" />',
    '<div role="REGION" />',
    '<div role="region" aria-label="Overview" />',
    '<div role="region" aria-labelledby="overview-title" />',
    '<div role="region" title="Overview" />',
    '<div role="region" aria-label={label} />',
    '<div role="region" aria-label="" />',
    '<div role="region" aria-labelledby={undefined} />',
    '<div role="region" title={null} />',
    '<div role="region" {...props} />',
    '<div {...props} role="region" />',
    '<div role="region" is="custom-region" />',
    '<div role="region" hidden />',
    '<div role="region" hidden="" />',
    '<div role="region" hidden={false} />',
    '<div role="region" aria-hidden="true" />',
    '<div role="region" aria-hidden={false} />',
    '<div role="region" inert />',
    '<div hidden><div role="region" /></div>',
    '<div aria-hidden="false"><div role="region" /></div>',
    '<div inert><div role="region" /></div>',
    '<div {...props}><div role="region" /></div>',
    '<div role="button"><div role="region" /></div>',
    '<button><div role="region" /></button>',
    '<div role="region" style={{display:"none"}} />',
    '<div style={{visibility:"hidden"}}><div role="region" /></div>',
    '<Region role="region" />',
    '<UI.Region role="region" />',
    '<Unknown><div role="region" /></Unknown>',
    '<Motion.div><div role="region" /></Motion.div>',
    '<svg><div role="region" /></svg>',
    '<math><div role="region" /></math>',
    '<template><div role="region" /></template>',
    '<noscript><div role="region" /></noscript>',
    '<script><div role="region" /></script>',
    '<style><div role="region" /></style>',
    '<textarea><div role="region" /></textarea>',
    '<title><div role="region" /></title>',
    '<iframe><div role="region" /></iframe>',
    '<object><div role="region" /></object>',
    '<embed><div role="region" /></embed>',
    '<div data-render={<div role="region" />} />',
    '<div children={<div role="region" />} />',
    '<div data-slot={{content:<div role="region" />}} />',
    'const View = () => <>{false && <section role="region" />}</>;',
    'const View = () => <>{true || <section role="region" />}</>;',
    'const View = () => true ? null : <section role="region" />;',
    'const View = () => false ? <section role="region" /> : null;',
    'const View = () => { if (false) return <section role="region" />; return null; };',
    'const View = () => { return null; return <section role="region" />; };',
  ])("leaves named or unsupported contexts quiet (%s)", (code) => {
    const result = runRule(regionHasAccessibleName, code);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("region finalizer catch admission", () => {
  it.each([
    'const View = () => { try { for (;;) {} } catch { return null; } finally { return <section role="region" />; } };',
    'const View = () => { try { for (;;) {} throw new Error("stop"); } catch { return null; } finally { return <section role="region" />; } };',
  ])("does not promote an unreachable catch exit (%s)", (code) => {
    const result = runRule(regionHasAccessibleName, code);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("region control-flow reachability", () => {
  it.each([
    {
      name: "plain-return",
      code: 'const View = () => <section role="region" />;',
      expected: 1,
    },
    {
      name: "heading-does-not-name",
      code: 'const View = () => <section role="region"><h2>Overview</h2></section>;',
      expected: 1,
    },
    {
      name: "dynamic-branch",
      code: 'const View = () => <>{active && <section role="region" />}</>;',
      expected: 1,
    },
    {
      name: "normal-finally",
      code: 'const View = () => { try {} finally { return <section role="region" />; } };',
      expected: 1,
    },
    {
      name: "return-finally",
      code: 'const View = () => { try { return null; } finally { return <section role="region" />; } };',
      expected: 1,
    },
    {
      name: "catch-return-finally",
      code: 'const View = () => { try { throw new Error("stop"); } catch { return null; } finally { return <section role="region" />; } };',
      expected: 1,
    },
    {
      name: "throw-finally",
      code: 'const View = () => { try { throw new Error("stop"); } finally { return <section role="region" />; } };',
      expected: 1,
    },
    {
      name: "break-finally",
      code: 'const View = () => { for (;;) { try { break; } finally { return <section role="region" />; } } return null; };',
      expected: 1,
    },
    {
      name: "continue-finally",
      code: 'const View = () => { for (;;) { try { continue; } finally { return <section role="region" />; } } };',
      expected: 1,
    },
    {
      name: "catch-throw-finally",
      code: 'const View = () => { try { throw new Error("first"); } catch { throw new Error("second"); } finally { return <section role="region" />; } };',
      expected: 1,
    },
    {
      name: "post-return",
      code: 'const View = () => { return null; return <section role="region" />; };',
      expected: 0,
    },
    {
      name: "dead-try",
      code: 'const View = () => { return null; try {} finally { return <section role="region" />; } };',
      expected: 0,
    },
    {
      name: "dead-branch-try",
      code: 'const View = () => { if (false) { try { return null; } finally { return <section role="region" />; } } return null; };',
      expected: 0,
    },
    {
      name: "dead-finally-branch",
      code: 'const View = () => { try { return null; } finally { if (false) return <section role="region" />; } };',
      expected: 0,
    },
    {
      name: "post-return-in-finally",
      code: 'const View = () => { try {} finally { return null; return <section role="region" />; } };',
      expected: 0,
    },
    {
      name: "nested-owner-boundary",
      code: 'const View = () => { try { return null; } finally { const Inner = () => { return null; return <section role="region" />; }; return null; } };',
      expected: 0,
    },
    {
      name: "named-finally",
      code: 'const View = () => { try { return null; } finally { return <section role="region" aria-label="Overview" />; } };',
      expected: 0,
    },
    {
      name: "hidden-finally",
      code: 'const View = () => { try { return null; } finally { return <section role="region" hidden={false} />; } };',
      expected: 0,
    },
    {
      name: "opaque-finally",
      code: 'const View = () => { try { return null; } finally { return <Unknown><section role="region" /></Unknown>; } };',
      expected: 0,
    },
    {
      name: "spread-finally",
      code: 'const View = () => { try { return null; } finally { return <section role="region" {...props} />; } };',
      expected: 0,
    },
    {
      name: "title-name",
      code: 'const View = () => <section role="region" title="Overview" />;',
      expected: 0,
    },
    {
      name: "empty-label",
      code: 'const View = () => <section role="region" aria-label="" />;',
      expected: 0,
    },
    {
      name: "undefined-labelledby",
      code: 'const View = () => <section role="region" aria-labelledby={undefined} />;',
      expected: 0,
    },
    {
      name: "role-fallback-tokens",
      code: 'const View = () => <section role="region main" />;',
      expected: 0,
    },
    {
      name: "unsupported-span-parent",
      code: 'const View = () => <span><section role="region" /></span>;',
      expected: 0,
    },
    {
      name: "opaque-prop",
      code: 'const View = () => <div data-render={<section role="region" />} />;',
      expected: 0,
    },
    {
      name: "implicit-section",
      code: "const View = () => <section><h2>Overview</h2></section>;",
      expected: 0,
    },
    {
      name: "ancestor-role",
      code: 'const View = () => <div role="button"><section role="region" /></div>;',
      expected: 0,
    },
    {
      name: "literal-true-exit-post-guard",
      code: 'const View = () => { if (true) return null; return <section role="region" />; };',
      expected: 0,
    },
    {
      name: "literal-false-exit-post-guard",
      code: 'const View = () => { if (false) return null; return <section role="region" />; };',
      expected: 1,
    },
    {
      name: "unknown-exit-post-guard",
      code: 'const View = () => { if (done) return null; return <section role="region" />; };',
      expected: 1,
    },
    {
      name: "truthy-numeric-exit-post-guard",
      code: 'const View = () => { if (1) return null; return <section role="region" />; };',
      expected: 0,
    },
    {
      name: "falsey-numeric-exit-post-guard",
      code: 'const View = () => { if (0) return null; return <section role="region" />; };',
      expected: 1,
    },
    {
      name: "unary-not-false-exit-post-guard",
      code: 'const View = () => { if (!false) return null; return <section role="region" />; };',
      expected: 0,
    },
    {
      name: "caught-static-throw-allows-region",
      code: 'const View = () => { try { if (true) throw new Error("stop"); } catch {} return <section role="region" />; };',
      expected: 1,
    },
    {
      name: "static-exit-finally-return-override",
      code: 'const View = () => { try { if (true) return null; } finally { return <section role="region" />; } };',
      expected: 1,
    },
    {
      name: "infinite-try",
      code: 'const View = () => { try { for (;;) {} } finally { return <section role="region" />; } };',
      expected: 0,
    },
    {
      name: "inner-loop-continue",
      code: 'const View = () => { try { for (;;) { continue; } } finally { return <section role="region" />; } };',
      expected: 0,
    },
    {
      name: "orphan-return-after-continue",
      code: 'const View = () => { try { for (;;) { continue; return null; } } finally { return <section role="region" />; } };',
      expected: 0,
    },
    {
      name: "orphan-return-after-infinite-loop",
      code: 'const View = () => { try { for (;;) {} return null; } finally { return <section role="region" />; } };',
      expected: 0,
    },
    {
      name: "dead-static-return-in-try",
      code: 'const View = () => { try { if (false) return null; for (;;) {} } finally { return <section role="region" />; } };',
      expected: 0,
    },
    {
      name: "inner-loop-break-still-live",
      code: 'const View = () => { if (true) { for (;;) { break; return null; } } return <section role="region" />; };',
      expected: 1,
    },
    {
      name: "static-throw-post-guard",
      code: 'const View = () => { if (true) throw new Error("stop"); return <section role="region" />; };',
      expected: 0,
    },
    {
      name: "literal-false-alternate-return",
      code: 'const View = () => { if (false) {} else return null; return <section role="region" />; };',
      expected: 0,
    },
    {
      name: "static-selected-region",
      code: 'const View = () => { if (true) return <section role="region" />; return null; };',
      expected: 1,
    },
    {
      name: "static-unselected-region",
      code: 'const View = () => { if (1) return null; else return <section role="region" />; };',
      expected: 0,
    },
    {
      name: "nested-finalizer",
      code: 'const View = () => { try { return null; } finally { try { return null; } finally { return <section role="region" />; } } };',
      expected: 1,
    },
    {
      name: "nested-dead-finalizer",
      code: 'const View = () => { try { return null; } finally { return null; try { return null; } finally { return <section role="region" />; } } };',
      expected: 0,
    },
    {
      name: "post-try-finalizer-return",
      code: 'const View = () => { try { return null; } finally { return null; } return <section role="region" />; };',
      expected: 0,
    },
    {
      name: "post-try-finalizer-fallthrough",
      code: 'const View = () => { try { return null; } finally {} return <section role="region" />; };',
      expected: 0,
    },
    {
      name: "dynamic-finalizer-path",
      code: 'const View = () => { try { if (ready) return null; for (;;) {} } finally { return <section role="region" />; } };',
      expected: 1,
    },
    {
      name: "sibling-dynamic-branch",
      code: 'const View = () => { if (ready) return null; else return <section role="region" />; };',
      expected: 1,
    },
  ])("$name", ({ code, expected }) => {
    const result = runRule(regionHasAccessibleName, code);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(expected);
  });
});

describe("region semantic analysis laziness", () => {
  it.each([
    "const value = 1;",
    '<button role="region" />;',
    '<section role="group" />;',
    '<section role="region" aria-label="Overview" />;',
    '<Unknown><section role="region" /></Unknown>;',
    '<section role="region" hidden={false} />;',
    '<section role="region" {...props} />;',
    '<div role="button"><section role="region" /></div>;',
  ])("does not request scopes or CFG for an excluded file (%s)", (code) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toHaveLength(0);
    attachParentReferences(parsed.program);
    const context: RuleContext = {
      report: () => {
        throw new Error("Excluded regions must not report");
      },
      get cfg(): never {
        throw new Error("Excluded regions must not request CFG");
      },
      get scopes(): never {
        throw new Error("Excluded regions must not request scopes");
      },
    };
    const visitors = regionHasAccessibleName.create(context);
    expect(() => {
      astTraversal.walkAst(parsed.program, (node) => {
        if (isNodeOfType(node, "JSXOpeningElement")) visitors.JSXOpeningElement?.(node);
      });
    }).not.toThrow();
  });

  it("resolves control flow only on the first matching region and does not request scopes", () => {
    const parsed = parseFixture(
      'const View = () => <><section role="region" /><aside role="region" /></>;',
    );
    expect(parsed.errors).toHaveLength(0);
    attachParentReferences(parsed.program);
    const controlFlow = analyzeControlFlow(parsed.program);
    let controlFlowReads = 0;
    let diagnostics = 0;
    const context: RuleContext = {
      report: () => {
        diagnostics += 1;
      },
      get cfg() {
        controlFlowReads += 1;
        return controlFlow;
      },
      get scopes(): never {
        throw new Error("These regions do not require scope analysis");
      },
    };
    const visitors = regionHasAccessibleName.create(context);
    expect(controlFlowReads).toBe(0);
    astTraversal.walkAst(parsed.program, (node) => {
      if (isNodeOfType(node, "JSXOpeningElement")) visitors.JSXOpeningElement?.(node);
    });
    expect(diagnostics).toBe(2);
    expect(controlFlowReads).toBe(1);
  });
});

describe("region finalizer work bounds", () => {
  it.each([128, 1000])(
    "walks a %s-statement try body a fixed number of times for as many regions",
    (count) => {
      const statements = Array.from(
        { length: count },
        (_, index) => `const value${index} = ${index};`,
      ).join("\n");
      const regions = Array.from({ length: count }, () => '<section role="region" />').join("\n");
      const code = `function View() { try { ${statements} return null; } finally { return <>${regions}</>; } }`;
      const originalWalk = astTraversal.walkAst;
      const bodyWalkVisits: number[] = [];
      let expectedBodyNodes = 0;
      let ownerWalks = 0;
      const spy = vi.spyOn(astTraversal, "walkAst").mockImplementation((node, visit) => {
        if (isNodeOfType(node, "FunctionDeclaration") && node.id?.name === "View") ownerWalks += 1;
        const isTryBody =
          isNodeOfType(node, "BlockStatement") &&
          isNodeOfType(node.parent, "TryStatement") &&
          node.parent.block === node;
        if (!isTryBody) return originalWalk(node, visit);
        if (expectedBodyNodes === 0)
          originalWalk(node, () => {
            expectedBodyNodes += 1;
          });
        let visitedNodes = 0;
        originalWalk(node, (child) => {
          visitedNodes += 1;
          return visit(child);
        });
        bodyWalkVisits.push(visitedNodes);
      });
      try {
        const result = runRule(regionHasAccessibleName, code);
        expect(result.parseErrors).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(count);
        expect(ownerWalks).toBe(1);
        expect(bodyWalkVisits).toEqual([expectedBodyNodes, expectedBodyNodes]);
      } finally {
        spy.mockRestore();
      }
    },
  );
});
