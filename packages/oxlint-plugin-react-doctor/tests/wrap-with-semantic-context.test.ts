import { describe, expect, it } from "vite-plus/test";
import type { BaseRuleContext, RuleContext } from "../src/plugin/utils/rule-context.js";
import type { Rule } from "../src/plugin/utils/rule.js";
import { wrapWithSemanticContext } from "../src/plugin/utils/wrap-with-semantic-context.js";

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
