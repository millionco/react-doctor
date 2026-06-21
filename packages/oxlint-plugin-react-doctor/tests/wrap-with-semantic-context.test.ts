import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "../src/plugin/utils/es-tree-node.js";
import type { BaseRuleContext, RuleContext } from "../src/plugin/utils/rule-context.js";
import type { Rule } from "../src/plugin/utils/rule.js";
import { wrapWithSemanticContext } from "../src/plugin/utils/wrap-with-semantic-context.js";
import { attachParentReferences } from "../src/test-utils/attach-parent-references.js";
import { parseFixture } from "../src/test-utils/parse-fixture.js";

// Capture the enriched `RuleContext` the wrapper hands to a rule's
// `create()` so we can assert how `filename` is resolved.
const captureEnrichedContext = (hostContext: BaseRuleContext): RuleContext => {
  let captured: RuleContext | undefined;
  const probeRule: Rule = {
    id: "probe",
    severity: "warn",
    create: (context: RuleContext) => {
      captured = context;
      return {};
    },
  };
  wrapWithSemanticContext(probeRule).create(hostContext);
  if (!captured) throw new Error("rule create() was never invoked");
  return captured;
};

describe("wrapWithSemanticContext — filename resolution (#539)", () => {
  // Mimics ESLint 9's FileContext: a public `filename` field plus a
  // `this`-bound `getFilename()` class method. The original wrapper copied
  // the bare method reference, which dropped `this` and returned undefined.
  class EslintLikeContext {
    constructor(readonly filename: string) {}
    report(): void {}
    getFilename(): string {
      return this.filename;
    }
  }

  it("returns the host filename for an ESLint-style this-bound context", () => {
    const context = captureEnrichedContext(new EslintLikeContext("/proj/src/axios.ts"));
    expect(context.filename).toBe("/proj/src/axios.ts");
  });

  it("falls back to getFilename() bound to the host when no `filename` property exists", () => {
    // A host that only exposes the deprecated accessor, reading from an
    // internal field via `this`. Forwarding a detached reference would
    // read `this.internalName` off the wrong object and lose the value.
    class BoundMethodOnlyContext {
      constructor(private readonly internalName: string) {}
      report(): void {}
      getFilename(): string {
        return this.internalName;
      }
    }
    const context = captureEnrichedContext(new BoundMethodOnlyContext("/proj/src/app.tsx"));
    expect(context.filename).toBe("/proj/src/app.tsx");
  });

  it("prefers the modern `filename` property", () => {
    const context = captureEnrichedContext({ filename: "/proj/src/page.tsx", report: () => {} });
    expect(context.filename).toBe("/proj/src/page.tsx");
  });

  it("returns undefined when the host exposes no filename at all", () => {
    const context = captureEnrichedContext({ report: () => {} });
    expect(context.filename).toBeUndefined();
  });
});

// Drives one wrapper instance over `programNode`: invokes the rule's
// `create()` (capturing the enriched context) and fires the returned
// `Program` visitor so the wrapper captures its root, exactly as oxlint
// does at runtime. Returns the enriched context so a test can read its
// shared-analysis getters.
const driveWrapperOverProgram = (programNode: EsTreeNode): RuleContext => {
  let captured: RuleContext | undefined;
  const probeRule: Rule = {
    id: "probe",
    severity: "warn",
    create: (context: RuleContext) => {
      captured = context;
      return {};
    },
  };
  const visitors = wrapWithSemanticContext(probeRule).create({ report: () => {} });
  const programVisitor = visitors.Program;
  if (typeof programVisitor !== "function") throw new Error("Program visitor was never installed");
  programVisitor(programNode);
  if (!captured) throw new Error("rule create() was never invoked");
  return captured;
};

const parseProgram = (code: string): EsTreeNode => {
  const parsed = parseFixture(code);
  if (parsed.errors.length > 0) {
    throw new Error(`fixture failed to parse: ${parsed.errors.map((e) => e.message).join("; ")}`);
  }
  attachParentReferences(parsed.program);
  return parsed.program;
};

describe("wrapWithSemanticContext — cross-rule analysis sharing", () => {
  const FIXTURE = `
    function f(p) {
      let x;
      if (p) {
        x = 1;
      } else {
        x = 2;
      }
      return x + p;
    }
  `;

  it("shares one scope/CFG/SSA/dataflow build across two rules over the same Program", () => {
    const program = parseProgram(FIXTURE);

    const first = driveWrapperOverProgram(program);
    const second = driveWrapperOverProgram(program);

    // Reference equality proves both wrapper instances hit the same
    // WeakMap entry rather than each rebuilding its own analysis.
    expect(second.scopes).toBe(first.scopes);
    expect(second.cfg).toBe(first.cfg);
    expect(second.ssa).toBe(first.ssa);
    expect(second.dataflow).toBe(first.dataflow);
  });

  it("threads the shared CFG into SSA and dataflow instead of rebuilding it", () => {
    const program = parseProgram(FIXTURE);
    const context = driveWrapperOverProgram(program);

    // `SsaAnalysis.controlFlow` is the CFG SSA was built on; it must be the
    // very CFG the wrapper exposes as `context.cfg`, proving the 3rd-arg
    // reuse rather than an internal `analyzeControlFlow` rebuild.
    expect(context.ssa.controlFlow).toBe(context.cfg);
  });

  it("keys per Program root — a different file gets a distinct build", () => {
    const firstProgram = parseProgram(FIXTURE);
    const secondProgram = parseProgram(FIXTURE);

    const first = driveWrapperOverProgram(firstProgram);
    const second = driveWrapperOverProgram(secondProgram);

    expect(second.cfg).not.toBe(first.cfg);
    expect(second.scopes).not.toBe(first.scopes);
  });
});
