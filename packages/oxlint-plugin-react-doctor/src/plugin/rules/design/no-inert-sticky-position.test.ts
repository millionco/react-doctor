import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInertStickyPosition } from "./no-inert-sticky-position.js";

describe("no-inert-sticky-position", () => {
  it("reports Tailwind sticky without an inset", () => {
    const result = runRule(
      noInertStickyPosition,
      `const Header = () => <header className="sticky z-10 bg-white" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports inline sticky without an inset", () => {
    const result = runRule(
      noInertStickyPosition,
      `const Header = () => <header style={{ position: "sticky", zIndex: 10 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows physical and logical insets", () => {
    const result = runRule(
      noInertStickyPosition,
      `const A = () => <header className="sticky top-0" />;
       const B = () => <aside style={{ position: "sticky", insetBlockStart: 0 }} />;
       const C = () => <aside className="sticky" style={{ bottom: 0 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows negative Tailwind insets", () => {
    const result = runRule(
      noInertStickyPosition,
      `const Header = () => <header className="sticky -top-4" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports auto insets", () => {
    const result = runRule(
      noInertStickyPosition,
      `const A = () => <header className="sticky top-auto" />;
       const B = () => <aside style={{ position: "sticky", top: "auto" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("skips variant-only and dynamic positioning", () => {
    const result = runRule(
      noInertStickyPosition,
      `const A = () => <header className="md:sticky md:top-0" />;
       const B = ({ position }) => <header style={{ position }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
