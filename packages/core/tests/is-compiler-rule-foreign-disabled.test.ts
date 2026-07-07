import { describe, expect, it } from "vite-plus/test";
import { evaluateSuppression } from "@react-doctor/core";

const linesOf = (source: string): string[] => source.split("\n");

const isSuppressed = (lines: string[], diagnosticLineIndex: number, ruleId: string): boolean =>
  evaluateSuppression(lines, diagnosticLineIndex, ruleId).isSuppressed;

describe("React Compiler diagnostics honor the eslint-plugin-react-hooks disable spelling", () => {
  it("suppresses via eslint-disable-next-line react-hooks/<rule>", () => {
    const lines = linesOf(
      `// eslint-disable-next-line react-hooks/refs -- read in render is intentional here\n` +
        `const width = widthRef.current;\n`,
    );
    expect(isSuppressed(lines, 1, "react-hooks-js/refs")).toBe(true);
  });

  it("suppresses via eslint-disable-line react-hooks/<rule> on the flagged line", () => {
    const lines = linesOf(
      `state.items.push(item); // eslint-disable-line react-hooks/immutability\n`,
    );
    expect(isSuppressed(lines, 0, "react-hooks-js/immutability")).toBe(true);
  });

  it("suppresses via the plugin's own react-hooks-js/<rule> spelling", () => {
    const lines = linesOf(
      `// oxlint-disable-next-line react-hooks-js/refs\nconst width = widthRef.current;\n`,
    );
    expect(isSuppressed(lines, 1, "react-hooks-js/refs")).toBe(true);
  });

  it("suppresses inside an open eslint-disable block naming the rule", () => {
    const lines = linesOf(
      `/* eslint-disable react-hooks/refs */\n` +
        `const a = 1;\n` +
        `const width = widthRef.current;\n`,
    );
    expect(isSuppressed(lines, 2, "react-hooks-js/refs")).toBe(true);
  });

  it("does not suppress past a matching eslint-enable", () => {
    const lines = linesOf(
      `/* eslint-disable react-hooks/refs */\n` +
        `const a = 1;\n` +
        `/* eslint-enable react-hooks/refs */\n` +
        `const width = widthRef.current;\n`,
    );
    expect(isSuppressed(lines, 3, "react-hooks-js/refs")).toBe(false);
  });

  it("does not suppress when the directive names a different compiler rule", () => {
    const lines = linesOf(
      `// eslint-disable-next-line react-hooks/immutability\nconst width = widthRef.current;\n`,
    );
    expect(isSuppressed(lines, 1, "react-hooks-js/refs")).toBe(false);
  });

  it("does not suppress for a bare directive with no rule list", () => {
    const lines = linesOf(`// eslint-disable-next-line\nconst width = widthRef.current;\n`);
    expect(isSuppressed(lines, 1, "react-hooks-js/refs")).toBe(false);
  });

  it("never applies the react-hooks spelling to non-compiler diagnostics", () => {
    const lines = linesOf(
      `// eslint-disable-next-line react-hooks/exhaustive-deps\nconst x = 1;\n`,
    );
    expect(isSuppressed(lines, 1, "react-doctor/exhaustive-deps")).toBe(false);
  });
});
