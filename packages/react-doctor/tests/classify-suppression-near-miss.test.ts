import { describe, expect, it } from "vite-plus/test";
import { classifySuppressionNearMiss } from "../src/core/classify-suppression-near-miss.js";

const linesOf = (source: string): string[] => source.split("\n");

describe("classifySuppressionNearMiss", () => {
  it("returns null when no nearby disable-next-line comment exists", () => {
    const lines = linesOf(`const x = 1;\nconst y = 2;\n`);
    expect(
      classifySuppressionNearMiss(lines, 1, "react-doctor/no-derived-state-effect"),
    ).toBeNull();
  });

  it("emits a wrong-rule hint when an adjacent comment lists different rules", () => {
    const lines = linesOf(
      `// react-doctor-disable-next-line react-doctor/no-fetch-in-effect\nconst x = 1;\n`,
    );
    const hint = classifySuppressionNearMiss(lines, 1, "react-doctor/no-derived-state-effect");
    expect(hint).not.toBeNull();
    expect(hint).toContain("comma form");
    expect(hint).toContain("react-doctor/no-derived-state-effect");
  });

  it("emits a gap-code hint when a code line breaks the chain to the matching comment", () => {
    const lines = linesOf(
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst intervening = 1;\nconst x = 1;\n`,
    );
    const hint = classifySuppressionNearMiss(lines, 2, "react-doctor/no-derived-state-effect");
    expect(hint).not.toBeNull();
    expect(hint).toContain("Move the comment");
    expect(hint).toContain("line 3");
  });

  it("considers the JSX opener anchor for diagnostics inside multi-line elements", () => {
    const lines = linesOf(
      `// react-doctor-disable-next-line react-doctor/no-fetch-in-effect\n<li\n  key={"x"}\n>\n`,
    );
    const hint = classifySuppressionNearMiss(lines, 2, "react-doctor/no-derived-state-effect");
    expect(hint).not.toBeNull();
    expect(hint).toContain("comma form");
  });

  it("returns null when the adjacent comment correctly matches (the suppression is active, not near-missed)", () => {
    const lines = linesOf(
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst x = 1;\n`,
    );
    expect(
      classifySuppressionNearMiss(lines, 1, "react-doctor/no-derived-state-effect"),
    ).toBeNull();
  });
});
