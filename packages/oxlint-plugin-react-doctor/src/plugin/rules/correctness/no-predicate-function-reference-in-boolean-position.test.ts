import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPredicateFunctionReferenceInBooleanPosition } from "./no-predicate-function-reference-in-boolean-position.js";

describe("no-predicate-function-reference-in-boolean-position", () => {
  it("flags `if (!isShopBoardsV0On)` (Faire commit shape)", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isShopBoardsV0On() {
        return featureFlags.shopBoards;
      }
      function followBrand() {
        if (!isShopBoardsV0On) {
          return;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("isShopBoardsV0On()");
  });

  it("flags a bare predicate in an if test", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      const isReady = () => true;
      if (isReady) {
        start();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a predicate in a ternary test", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function hasAccess() { return true; }
      const label = hasAccess ? "yes" : "no";
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a predicate in a while test", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function shouldContinue() { return false; }
      while (shouldContinue) {
        step();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a predicate operand inside an `if (a && ...)` test", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function canEdit() { return true; }
      function render(user) {
        if (user.loggedIn && canEdit) {
          edit();
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the predicate is called", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isReady() { return true; }
      if (isReady()) {
        start();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a PascalCase component existence check", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function IsLazy() { return null; }
      function App() {
        if (IsLazy) {
          return <IsLazy />;
        }
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a boolean variable named like a predicate", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      const isActive = true;
      if (isActive) {
        run();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a predicate passed as a callback", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      const isEven = (n) => n % 2 === 0;
      const evens = numbers.filter(isEven);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a one-arg predicate reference (a real callback shape)", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isValid(value) { return Boolean(value); }
      const check = isValid || defaultCheck;
      if (check) {
        run();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a predicate used for value selection with ||", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isReady() { return true; }
      const chosen = isReady || fallback;
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an imported predicate (arity/type unknown)", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      import { isMobile } from "./env";
      if (isMobile) {
        renderMobile();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a predicate stored then existence-checked before calling", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isActive() { return true; }
      const check = isActive;
      if (check) {
        check();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
