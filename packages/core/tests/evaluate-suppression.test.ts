import { describe, expect, it } from "vite-plus/test";
import { evaluateSuppression } from "@react-doctor/core";

const linesOf = (source: string): string[] => source.split("\n");

const nearMissHintFor = (lines: string[], diagnosticLineIndex: number, ruleId: string) =>
  evaluateSuppression(lines, diagnosticLineIndex, ruleId).nearMissHint;

describe("evaluateSuppression near-miss hints", () => {
  it("marks same-line disable-line comments as suppressed", () => {
    const lines = linesOf(
      `const x = 1; // react-doctor-disable-line react-doctor/no-derived-state-effect\n`,
    );
    const result = evaluateSuppression(lines, 0, "react-doctor/no-derived-state-effect");
    expect(result).toEqual({ isSuppressed: true, nearMissHint: null });
  });

  it("marks stacked disable-next-line comments as suppressed when each rule is listed separately", () => {
    const lines = linesOf(
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\n` +
        `// react-doctor-disable-next-line react-doctor/no-fetch-in-effect\n` +
        `const x = 1;\n`,
    );
    expect(evaluateSuppression(lines, 2, "react-doctor/no-derived-state-effect")).toEqual({
      isSuppressed: true,
      nearMissHint: null,
    });
    expect(evaluateSuppression(lines, 2, "react-doctor/no-fetch-in-effect")).toEqual({
      isSuppressed: true,
      nearMissHint: null,
    });
  });

  it("returns null when no nearby disable-next-line comment exists", () => {
    const lines = linesOf(`const x = 1;\nconst y = 2;\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-derived-state-effect")).toBeNull();
  });

  it("emits a wrong-rule hint when an adjacent comment lists different rules", () => {
    const lines = linesOf(
      `// react-doctor-disable-next-line react-doctor/no-fetch-in-effect\nconst x = 1;\n`,
    );
    const hint = nearMissHintFor(lines, 1, "react-doctor/no-derived-state-effect");
    expect(hint).not.toBeNull();
    expect(hint).toContain("comma form");
    expect(hint).toContain("react-doctor/no-derived-state-effect");
  });

  it("emits a gap-code hint when a code line breaks the chain to the matching comment", () => {
    const lines = linesOf(
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst intervening = 1;\nconst x = 1;\n`,
    );
    const hint = nearMissHintFor(lines, 2, "react-doctor/no-derived-state-effect");
    expect(hint).not.toBeNull();
    expect(hint).toContain("Move the comment");
    expect(hint).toContain("line 3");
  });

  it("considers the JSX opener anchor for diagnostics inside multi-line elements", () => {
    const lines = linesOf(
      `// react-doctor-disable-next-line react-doctor/no-fetch-in-effect\n<li\n  key={"x"}\n>\n`,
    );
    const hint = nearMissHintFor(lines, 2, "react-doctor/no-derived-state-effect");
    expect(hint).not.toBeNull();
    expect(hint).toContain("comma form");
  });

  it("returns null when the adjacent comment correctly matches (the suppression is active, not near-missed)", () => {
    const lines = linesOf(
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst x = 1;\n`,
    );
    expect(nearMissHintFor(lines, 1, "react-doctor/no-derived-state-effect")).toBeNull();
  });

  it("returns null when a description follows the matching rule list", () => {
    const lines = linesOf(
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect -- intentional fixture state mirror\nconst x = 1;\n`,
    );
    const result = evaluateSuppression(lines, 1, "react-doctor/no-derived-state-effect");
    expect(result).toEqual({ isSuppressed: true, nearMissHint: null });
  });
});

describe("evaluateSuppression — foreign (eslint/oxlint) disable near-miss hints", () => {
  it("hints when a bare short id is used in an adjacent eslint-disable-next-line", () => {
    const lines = linesOf(`// eslint-disable-next-line no-eval\neval(code);\n`);
    const hint = nearMissHintFor(lines, 1, "react-doctor/no-eval");
    expect(hint).not.toBeNull();
    expect(hint).toContain("react-doctor/no-eval");
    expect(hint).toContain("eslint-disable");
  });

  it("hints for oxlint-disable and names the right tool", () => {
    const lines = linesOf(`// oxlint-disable-next-line no-eval\neval(code);\n`);
    const hint = nearMissHintFor(lines, 1, "react-doctor/no-eval");
    expect(hint).toContain("oxlint-disable");
  });

  it("hints for a same-line eslint-disable-line directive", () => {
    const lines = linesOf(`eval(code); // eslint-disable-line no-eval\n`);
    const hint = nearMissHintFor(lines, 0, "react-doctor/no-eval");
    expect(hint).not.toBeNull();
    expect(hint).toContain("react-doctor/no-eval");
  });

  it("hints when a legacy plugin-prefixed alias is used", () => {
    const lines = linesOf(`// eslint-disable-next-line react/jsx-key\n<li />;\n`);
    const hint = nearMissHintFor(lines, 1, "react-doctor/jsx-key");
    expect(hint).not.toBeNull();
    expect(hint).toContain("react/jsx-key");
    expect(hint).toContain("react-doctor/jsx-key");
  });

  it("ignores the description tail when matching the rule list", () => {
    const lines = linesOf(`// eslint-disable-next-line no-eval -- legacy code path\neval(code);\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).not.toBeNull();
  });

  it("returns null when the canonical react-doctor/<id> name is used", () => {
    const lines = linesOf(`// eslint-disable-next-line react-doctor/no-eval\neval(code);\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).toBeNull();
  });

  it("returns null when the directive lists an unrelated rule", () => {
    const lines = linesOf(`// eslint-disable-next-line no-console\neval(code);\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).toBeNull();
  });

  it("returns null when the directive already lists the canonical key alongside a bare alias", () => {
    const lines = linesOf(
      `// eslint-disable-next-line react-doctor/no-eval, no-eval\neval(code);\n`,
    );
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).toBeNull();
  });

  it("returns null for a non-adjacent directive (placement, not naming)", () => {
    const lines = linesOf(
      `// eslint-disable-next-line no-eval\nconst intervening = 1;\neval(code);\n`,
    );
    expect(nearMissHintFor(lines, 2, "react-doctor/no-eval")).toBeNull();
  });

  it("returns null for non-react-doctor rules (the fix names a react-doctor key)", () => {
    const lines = linesOf(`// eslint-disable-next-line foo\nbar();\n`);
    expect(nearMissHintFor(lines, 1, "my-plugin/foo")).toBeNull();
  });
});

describe("evaluateSuppression — foreign block (range) disable near-miss hints", () => {
  it("hints for a file-level block disable that names the rule by its short id", () => {
    const lines = linesOf(`/* eslint-disable no-eval */\nconst a = 1;\neval(code);\n`);
    const hint = nearMissHintFor(lines, 2, "react-doctor/no-eval");
    expect(hint).not.toBeNull();
    expect(hint).toContain("react-doctor/no-eval");
  });

  it("names the right tool for an oxlint block disable", () => {
    const lines = linesOf(`/* oxlint-disable no-eval */\neval(code);\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).toContain("oxlint-disable");
  });

  it("hints for a legacy plugin-prefixed name in a block disable", () => {
    const lines = linesOf(`/* eslint-disable react/jsx-key */\n<li />;\n`);
    const hint = nearMissHintFor(lines, 1, "react-doctor/jsx-key");
    expect(hint).toContain("react-doctor/jsx-key");
  });

  it("returns null once a matching eslint-enable closes the range", () => {
    const lines = linesOf(
      `/* eslint-disable no-eval */\nconst a = 1;\n/* eslint-enable no-eval */\neval(code);\n`,
    );
    expect(nearMissHintFor(lines, 3, "react-doctor/no-eval")).toBeNull();
  });

  it("returns null when a bare eslint-enable re-enables everything", () => {
    const lines = linesOf(`/* eslint-disable no-eval */\n/* eslint-enable */\neval(code);\n`);
    expect(nearMissHintFor(lines, 2, "react-doctor/no-eval")).toBeNull();
  });

  it("returns null when the block disable sits below the diagnostic", () => {
    const lines = linesOf(`eval(code);\n/* eslint-disable no-eval */\n`);
    expect(nearMissHintFor(lines, 0, "react-doctor/no-eval")).toBeNull();
  });

  it("returns null for a rule-less disable-all block (no rule name to qualify)", () => {
    const lines = linesOf(`/* eslint-disable */\neval(code);\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).toBeNull();
  });

  it("returns null when the block disable uses the canonical name", () => {
    const lines = linesOf(`/* eslint-disable react-doctor/no-eval */\neval(code);\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).toBeNull();
  });

  it("returns null when a block disable lists the bare alias before the canonical key", () => {
    const lines = linesOf(`/* eslint-disable no-eval, react-doctor/no-eval */\neval(code);\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).toBeNull();
  });
});

describe("evaluateSuppression — react-doctor-disable with a bare short id now suppresses", () => {
  it("suppresses via a bare short id on react-doctor-disable-next-line", () => {
    const lines = linesOf(`// react-doctor-disable-next-line no-eval\neval(code);\n`);
    expect(evaluateSuppression(lines, 1, "react-doctor/no-eval")).toEqual({
      isSuppressed: true,
      nearMissHint: null,
    });
  });

  it("suppresses via a bare short id on a same-line react-doctor-disable-line", () => {
    const lines = linesOf(`eval(code); // react-doctor-disable-line no-eval\n`);
    expect(evaluateSuppression(lines, 0, "react-doctor/no-eval")).toEqual({
      isSuppressed: true,
      nearMissHint: null,
    });
  });
});

describe("evaluateSuppression — foreign disable matching is whitespace-robust", () => {
  it("hints despite heavy whitespace around an inline directive", () => {
    const lines = linesOf(`//      eslint-disable-next-line     no-eval\neval(code);\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).toContain("react-doctor/no-eval");
  });

  it("hints despite heavy whitespace inside a block directive", () => {
    const lines = linesOf(`/*    eslint-disable    no-eval    */\neval(code);\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).toContain("react-doctor/no-eval");
  });

  it("does not treat `disable-next-lineX` as a next-line directive", () => {
    const lines = linesOf(`// eslint-disable-next-lineX no-eval\neval(code);\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).toBeNull();
  });

  it("does not treat `eslint-disabled` as a block disable", () => {
    const lines = linesOf(`/* eslint-disabled no-eval */\neval(code);\n`);
    expect(nearMissHintFor(lines, 1, "react-doctor/no-eval")).toBeNull();
  });
});
