import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "./no-array-find-result-member-access-without-guard.js";

const aliasDeclarations = `
  const first = rows.find((row) => row.id === "first");
  const second = rows.find((row) => row.id === "second");
  const third = rows.find((row) => row.id === "third");
`;

describe("find-result aliases after compound guards", () => {
  it.each([
    "if (!first || !second) return null; return second.name;",
    'if (!first || !second || !third) throw new Error("missing"); return third.name;',
    "if (first == null || second === undefined) return null; return second.name;",
    "if (!first || (!second || !third)) return null; return third.name;",
    "return !first || !second ? null : second.name;",
    "return (!first || !second) || second.name;",
    "if (!(first && second)) return null; return second.name;",
    "if (!Boolean(second)) return null; return second.name;",
    "if (Boolean(second)) return second.name;",
    "if (!globalThis.Boolean(second)) return null; return second.name;",
    "function Boolean(value) { if (!value) throw new Error(); return true; } if (!Boolean(second)) return null; return second.name;",
  ])("recognizes every presence requirement of a false OR guard: %s", (code) => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `function render(rows, disabled) { ${aliasDeclarations} ${code} }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "if (!first && !second) return null; return second.name;",
    "if (first || second) return second.name;",
    "if (!first || !second) { if (disabled) return null; } return second.name;",
    "const name = second.name; if (!first || !second) return null; return name;",
    "const undefined = disabled; if (first === undefined || second === undefined) return null; return second.name;",
    "return (!first && !second) || second.name;",
    "if (!first || !second) stop(); return second.name;",
    "if (!first) return null; return second.name;",
    "if (!first || Boolean(second)) return null; return second.name;",
  ])("preserves an unsafe adjacent control: %s", (code) => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `function render(rows, disabled) { ${aliasDeclarations} ${code} }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
