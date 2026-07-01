import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDivisionOrModuloByUnguardedDenominator } from "./no-division-or-modulo-by-unguarded-denominator.js";

describe("no-division-or-modulo-by-unguarded-denominator", () => {
  it("flags a percentage width interpolated into a style string", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `const Bar = ({ homeShots, totalShots }) => (
        <div style={{ width: \`\${(homeShots / totalShots) * 100}%\` }} />
      );`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a progress percent computed for render", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `const Progress = ({ synced, pending }) => {
        const progress = Math.round((synced / pending) * 100);
        return <span>{progress}</span>;
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a completion ratio percentage", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `const pct = (completed / target) * 100;
       render(<div>{pct}</div>);`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a cyclic index over a state array", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `const Viewer = ({ matches }) => {
        const next = (prev + 1) % matches.length;
        return <span>{next}</span>;
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a dominating ternary guards the denominator", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `const pct = total === 0 ? 0 : (done / total) * 100;
       render(<div>{pct}</div>);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when an early-return guards the denominator", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `function ratio(made, attempted) {
        if (attempted <= 0) return 0;
        return (made / attempted) * 100;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for modulo over a const non-empty array literal", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `const FACTS = ["a", "b", "c"];
       const Card = ({ index }) => <p>{FACTS[index % FACTS.length]}</p>;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for modulo over a const palette", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `const PALETTE = ["#111", "#222"];
       const color = PALETTE[i % PALETTE.length];`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the division result never reaches a render/index sink", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `function report(sum, n) {
        const avg = sum / n;
        logger.debug(avg);
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not match printf-style percent in a string literal", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `const msg = "loaded %s of %d items";`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when dividing by a numeric literal", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `const half = value / 2;
       render(<div>{half}</div>);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the divisor has an || fallback", () => {
    const result = runRule(
      noDivisionOrModuloByUnguardedDenominator,
      `const pct = (done / (total || 1)) * 100;
       render(<div>{pct}</div>);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
