import { describe, expect, it } from "vite-plus/test";
import { fuzzRule } from "../src/fuzz-rule.js";
import type { Rule } from "../../oxlint-plugin-react-doctor/src/plugin/utils/rule.js";

describe("fuzz harness oracles", () => {
  it("catches a rule that crashes on JSX", () => {
    const crashingRule: Rule = {
      id: "fuzz-smoke-crash",
      severity: "warn",
      create: () => ({
        JSXOpeningElement: () => {
          throw new Error("boom");
        },
      }),
    };
    const findings = fuzzRule("fuzz-smoke-crash", crashingRule, { iterations: 10, seed: 1 });
    expect(findings.some((finding) => finding.kind === "crash")).toBe(true);
  });

  it("catches a rule that keys off incidental source shape", () => {
    const commentSensitiveRule: Rule = {
      id: "fuzz-smoke-invariant",
      severity: "warn",
      create: (context) => ({
        Program: (node) => {
          context.report({ message: `range ${JSON.stringify(node.range)}`, node });
        },
      }),
    };
    const findings = fuzzRule("fuzz-smoke-invariant", commentSensitiveRule, {
      iterations: 10,
      seed: 1,
      checkInvariants: true,
    });
    expect(findings.some((finding) => finding.kind === "invariant-violation")).toBe(true);
  });
});
