import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "./no-array-find-result-member-access-without-guard.js";

describe("no-array-find-result-member-access-without-guard", () => {
  it("flags a property read on a find() result (Faire zendesk shape)", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const id = response.data.locales.find((i) => i.locale === zendeskLocale).id;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an index access on a find() result", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const first = items.find((item) => item.active)[0];`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a call on a find() result", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const value = handlers.find((h) => h.type === type)();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags findLast() the same way", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const name = users.findLast((u) => u.enabled).name;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an identifier-predicate find()", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const isActive = (u) => u.active; const email = users.find(isActive).email;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags through parentheses", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const id = (rows.find((r) => r.ok)).id;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag optional-chained access", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const id = items.find((item) => item.active)?.id;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag optional-chained call", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const value = handlers.find((h) => h.type === type)?.();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a nullish-coalescing fallback", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const item = items.find((item) => item.active) ?? defaultItem;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a find() result bound to a variable then guarded", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `
      const found = items.find((item) => item.active);
      if (found) {
        doSomething(found.id);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ORM Model.find(callback) with a capitalized receiver", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const email = User.find((u) => u.id === 5).email;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ORM Model.find({ where }) object query", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const email = repo.find({ where: { id: 5 } }).email;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-null-asserted result (owned by the no-non-null rule)", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const id = items.find((item) => item.active)!.id;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the find() result is not immediately accessed", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const found = items.find((item) => item.active);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an enzyme wrapper.find(Component).instance() chain", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const inst = wrapper.find(AvatarImage).instance();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an enzyme wrapper.find(Component).first().props() chain", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const pop = wrapper.find(Tooltip).first().props();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an enzyme wrapper.find(Component).length read", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `expect(wrapper.find(VisuallyHidden).length).toBe(4);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a real array find() dereference inside a test file", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const id = items.find((item) => item.active).id;`,
      { filename: "widget.test.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
