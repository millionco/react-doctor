import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonNullAssertionOnMemberAccess } from "./no-non-null-assertion-on-member-access.js";

describe("no-non-null-assertion-on-member-access", () => {
  it("flags chained assertions on one path", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `const t = this.data!.brand_review!.token;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a plain chained assertion path a!.b!.c", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `const c = a!.b!.c;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a snake_case field followed by a collection method", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `returnOrder.order_items!.reduce((a, b) => a + b);`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a snake_case field followed by .map", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `orderItem.issue_images!.map((image) => image.url);`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a snake_case field dereferenced by a scalar member", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `const id = response.cart_items!.id;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a plain camelCase field followed by a collection method", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `config.plugins!.forEach((p) => p());`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag state.items!.map (camelCase base)", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `state.items!.map((x) => x);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain scalar dereference of a camelCase field", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `const s = obj.field!.scalar;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a computed-index base", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `const id = sortedArr[0]!.id;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ref.current!", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `const node = ref.current!.value;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an identifier ending in Ref", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `inputRef.current!.focus();`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a DOM lookup call result assertion", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `document.getElementById('x')!.focus();`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chained assertion rooted at a SCREAMING_SNAKE constant", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `const guide = { ...INFO_PAGE_COPY.zh!.agentGuides!['claude-code']! };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chained assertion rooted at a *Ref", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `triggerRef.current!.dataset!.awsuiSuppressTooltip = 'true';`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a chained assertion rooted at a local identifier", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `const value = increment!.cents!.amount;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a non-dereferenced snake_case assertion", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `const items = response.cart_items!;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in test files", () => {
    const result = runRule(
      noNonNullAssertionOnMemberAccess,
      `orderItem.issue_images!.map((image) => image.url);`,
      { filename: "ReportedItem.test.tsx" }
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
