import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noZIndex9999 } from "./no-z-index9999.js";

const run = (code: string) => runRule(noZIndex9999, code, { filename: "fixture.tsx" });

describe("design/no-z-index9999 — regressions", () => {
  it("does not flag negative z-index used to render behind everything", () => {
    const result = run(`const C = () => <div style={{ zIndex: -9999 }} />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag negative z-index in StyleSheet.create", () => {
    const result = run(`const styles = StyleSheet.create({ backdrop: { zIndex: -9999 } });`);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports the missing layering scale once per file", () => {
    const result = run(
      `const C = () => (
        <div>
          <div style={{ zIndex: 9999 }} />
          <div style={{ zIndex: 99999 }} />
          <div style={{ zIndex: 10050 }} />
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports once per file across StyleSheet.create entries", () => {
    const result = run(
      `const styles = StyleSheet.create({
        overlay: { zIndex: 9999 },
        toast: { zIndex: 99999 },
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an absurd inline z-index", () => {
    const result = run(`const C = () => <div style={{ zIndex: 9999 }} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an absurd z-index in StyleSheet.create", () => {
    const result = run(`const styles = StyleSheet.create({ modal: { zIndex: 9999 } });`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag values below the threshold", () => {
    const result = run(`const C = () => <div style={{ zIndex: 999 }} />;`);
    expect(result.diagnostics).toEqual([]);
  });
});
