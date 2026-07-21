import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUngatedTailwindAnimation } from "./no-ungated-tailwind-animation.js";

describe("no-ungated-tailwind-animation", () => {
  it("reports base and responsive animations without a reduced-motion path", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <><span className="animate-spin" /><span className="md:animate-[float_2s_infinite]" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows motion-safe gating and reduced-motion overrides", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <>
        <span className="motion-safe:animate-spin" />
        <span className="animate-pulse motion-reduce:animate-none" />
        <span className="animate-spin motion-reduce:hidden" />
        <span className="animate-bounce motion-reduce:animate-pulse" />
        <span className="animate-spin motion-reduce:animate-[fade_1s_ease-out]" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports spatial animations that run specifically under reduced motion", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <>
        <span className="motion-reduce:animate-spin" />
        <span className="motion-reduce:animate-ping" />
        <span className="motion-reduce:animate-bounce" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("requires a reduced-motion override to cover the animation variant scope", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <>
        <span className="animate-spin md:motion-reduce:animate-none" />
        <span className="md:animate-spin motion-reduce:animate-none" />
        <span className="dark:animate-spin dark:motion-reduce:animate-none" />
        <span className="lg:animate-spin md:motion-reduce:animate-none" />
        <span className="max-md:animate-spin max-lg:motion-reduce:animate-none" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("respects important animation precedence regardless of class order", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <>
        <span className="!animate-none animate-spin" />
        <span className="animate-spin !animate-none" />
        <span className="!animate-spin animate-none" />
        <span className="animate-none !animate-spin" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("skips conflicting equal-priority animation setters", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <>
        <span className="animate-spin animate-none" />
        <span className="animate-none animate-spin" />
        <span className="md:animate-spin md:animate-none" />
        <span className="md:animate-none md:animate-spin" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips conflicting important animation setters", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <>
        <span className="!animate-spin !animate-none" />
        <span className="!animate-none !animate-spin" />
        <span className="md:!animate-spin md:!animate-none" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips conflicting equal-priority reduced-motion alternatives", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <>
        <span className="animate-spin motion-reduce:animate-none motion-reduce:animate-bounce" />
        <span className="animate-spin motion-reduce:hidden motion-reduce:block" />
        <span className="animate-spin motion-reduce:invisible motion-reduce:visible" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports reduced-motion alternatives that are definitely overridden", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <>
        <span className="animate-spin motion-reduce:animate-none motion-reduce:!animate-spin" />
        <span className="animate-spin motion-reduce:hidden motion-reduce:!block" />
        <span className="animate-spin motion-reduce:invisible motion-reduce:!visible" />
        <span className="md:animate-spin motion-reduce:animate-none md:motion-reduce:animate-bounce" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("preserves balanced arbitrary values while tokenizing classes", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <span className="before:content-['Still loading'] animate-spin" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires important reduced-motion alternatives for important animations", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <>
        <span className="!animate-spin motion-reduce:animate-none" />
        <span className="!animate-spin motion-reduce:!animate-none" />
        <span className="md:!animate-spin motion-reduce:!animate-none" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips static none animations, dynamic classes, and spread-owned props", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = ({ className, props }) => <><span className="animate-none" /><span className="animate-[none]" /><span className="md:animate-[none]" /><span className={className} /><span className="animate-spin" {...props} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
