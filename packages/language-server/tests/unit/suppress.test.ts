import { describe, expect, it } from "vite-plus/test";
import {
  buildSuppressAllTextEdits,
  buildSuppressionTextEdit,
} from "../../src/features/suppress.js";

describe("buildSuppressionTextEdit", () => {
  it("inserts a line comment with matching indentation for a plain .ts statement", () => {
    const documentText = "const a = 1;\n  const b = 2;\n";
    const edit = buildSuppressionTextEdit({
      documentText,
      fsPath: "/repo/src/file.ts",
      line: 2,
      ruleId: "react-doctor/no-derived-state",
    });

    expect(edit.range).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 },
    });
    expect(edit.newText).toBe(
      "  // react-doctor-disable-next-line react-doctor/no-derived-state\n",
    );
  });

  it("inserts a JSX-style comment for a .tsx file when the target line looks like JSX", () => {
    const jsxLine = "        <li key={index}>{item}</li>";
    const documentText = `return (\n${jsxLine}\n);\n`;
    const edit = buildSuppressionTextEdit({
      documentText,
      fsPath: "/repo/src/list.tsx",
      line: 2,
      ruleId: "react-doctor/no-array-index-key",
    });

    expect(edit.range.start).toEqual({ line: 1, character: 0 });
    expect(edit.newText).toBe(
      "        {/* react-doctor-disable-next-line react-doctor/no-array-index-key */}\n",
    );
  });
});

describe("buildSuppressAllTextEdits", () => {
  it("merges multiple rules on the same line into a single edit", () => {
    const edits = buildSuppressAllTextEdits({
      documentText: "const a = 1;\nconst b = 2;\n",
      fsPath: "/repo/src/file.ts",
      targets: [
        { line: 1, ruleId: "react-doctor/rule-one" },
        { line: 1, ruleId: "react-doctor/rule-two" },
      ],
    });

    expect(edits).toHaveLength(1);
    expect(edits[0].newText).toContain("react-doctor/rule-one");
    expect(edits[0].newText).toContain("react-doctor/rule-two");
  });

  it("dedupes identical (line, ruleId) targets", () => {
    const edits = buildSuppressAllTextEdits({
      documentText: "const a = 1;\n",
      fsPath: "/repo/src/file.ts",
      targets: [
        { line: 1, ruleId: "react-doctor/no-array-index-key" },
        { line: 1, ruleId: "react-doctor/no-array-index-key" },
      ],
    });

    expect(edits).toHaveLength(1);
    const occurrenceCount = edits[0].newText.split("react-doctor/no-array-index-key").length - 1;
    expect(occurrenceCount).toBe(1);
  });
});
