import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSmoothScrollWithoutReducedMotion } from "./no-smooth-scroll-without-reduced-motion.js";

describe("no-smooth-scroll-without-reduced-motion", () => {
  it("reports literal inline smooth scrolling", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const Page = () => <main style={{ scrollBehavior: "smooth" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an unconditional Tailwind utility", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const Page = () => <main className="h-screen overflow-auto scroll-smooth" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows motion-safe and reduced-motion fallback utilities", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const A = () => <main className="motion-safe:scroll-smooth" />;
       const B = () => <main className="scroll-smooth motion-reduce:scroll-auto" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires the reduced-motion fallback to cover the smooth-scroll scope", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const Page = () => <>
        <main className="scroll-smooth md:motion-reduce:scroll-auto" />
        <main className="md:scroll-smooth motion-reduce:scroll-auto" />
        <main className="dark:scroll-smooth dark:motion-reduce:scroll-auto" />
        <main className="lg:scroll-smooth md:motion-reduce:scroll-auto" />
        <main className="max-md:scroll-smooth max-lg:motion-reduce:scroll-auto" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("respects important scroll behavior precedence", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const Page = () => <>
        <main className="!scroll-auto scroll-smooth" />
        <main className="scroll-smooth !scroll-auto" />
        <main className="!scroll-smooth scroll-auto" />
        <main className="scroll-auto !scroll-smooth" />
        <main className="!scroll-smooth motion-reduce:scroll-auto" />
        <main className="!scroll-smooth motion-reduce:!scroll-auto" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("skips conflicting equal-priority scroll setters", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const Page = () => <>
        <main className="scroll-smooth scroll-auto" />
        <main className="scroll-auto scroll-smooth" />
        <main className="!scroll-smooth !scroll-auto" />
        <main className="scroll-smooth motion-reduce:scroll-auto motion-reduce:scroll-smooth" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports reduced-motion fallbacks that are definitely overridden", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const Page = () => <>
        <main className="scroll-smooth motion-reduce:scroll-auto motion-reduce:!scroll-smooth" />
        <main className="md:scroll-smooth motion-reduce:scroll-auto md:motion-reduce:scroll-smooth" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not treat arbitrary-value fragments as smooth-scroll utilities", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const Page = () => <main className="[--behavior:scroll-smooth fallback]" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows instant and dynamic inline behavior", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const A = () => <main style={{ scrollBehavior: "auto" }} />;
       const B = ({ reduced }) => <main style={{ scrollBehavior: reduced ? "auto" : "smooth" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("respects important Tailwind fallbacks over inline smooth scrolling", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const Page = () => <>
        <main className="!scroll-auto" style={{ scrollBehavior: "smooth" }} />
        <main className="motion-reduce:!scroll-auto" style={{ scrollBehavior: "smooth" }} />
        <main className="scroll-auto" style={{ scrollBehavior: "smooth" }} />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips dynamic class names and authoritative spreads", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const A = ({ className }) => <main className={className} />;
       const B = ({ style }) => <main style={{ scrollBehavior: "smooth", ...style }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
