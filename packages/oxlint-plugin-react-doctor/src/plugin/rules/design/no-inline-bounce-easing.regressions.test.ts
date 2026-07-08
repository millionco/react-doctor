import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInlineBounceEasing } from "./no-inline-bounce-easing.js";

const expectFail = (code: string): void => {
  const result = runRule(noInlineBounceEasing, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(noInlineBounceEasing, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("design/no-inline-bounce-easing — regressions", () => {
  it("still flags a bare animate-bounce class", () => {
    expectFail(`const C = () => <div className="animate-bounce" />;`);
  });

  it("still flags an inline overshoot cubic-bezier transition", () => {
    expectFail(
      `const C = () => <div style={{ transition: "transform 300ms cubic-bezier(0.68, -0.55, 0.27, 1.55)" }} />;`,
    );
  });

  it("still flags an inline bounce animation name", () => {
    expectFail(`const C = () => <div style={{ animation: "bounce-in 400ms ease-out" }} />;`);
  });

  // Docs-validation r2: the staggered-dots typing indicator (StreamingMessage,
  // BlockPhase, useWebSocket demo) — animate-bounce plus an animation-delay
  // stagger is the canonical playful loading idiom the doc's fix prompt
  // reserves bounce for; replacing it would erase the affordance.
  it("does not flag animate-bounce staggered via an inline animationDelay style", () => {
    expectPass(
      `const C = () => (
        <div className="flex gap-1">
          <span className="w-2 h-2 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      );`,
    );
  });

  it("does not flag animate-bounce staggered via a Tailwind [animation-delay:] class", () => {
    expectPass(
      `const C = () => (
        <div className="flex gap-1">
          <span className="size-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
          <span className="size-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
        </div>
      );`,
    );
  });

  it("still flags animate-bounce when the inline style has no animationDelay", () => {
    expectFail(`const C = () => <div className="animate-bounce" style={{ color: "red" }} />;`);
  });
});
