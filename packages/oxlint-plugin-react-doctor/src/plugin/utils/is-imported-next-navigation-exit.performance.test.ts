import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import {
  NEXT_NOT_FOUND_PROOF_GUARD_COUNT,
  NEXT_NOT_FOUND_PROOF_READS_PER_ALIAS_COUNT,
} from "../../test-utils/next-not-found-proof/constants.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "../rules/correctness/no-array-find-result-member-access-without-guard.js";
import * as importProof from "./is-value-import-from-module.js";

const guardedAliasSource = Array.from(
  { length: NEXT_NOT_FOUND_PROOF_GUARD_COUNT },
  (_entry, index) => `
    const found${index} = rows.find((row) => row.id === "item-${index}");
    if (!found${index}) notFound();
    ${Array.from(
      { length: NEXT_NOT_FOUND_PROOF_READS_PER_ALIAS_COUNT },
      () => `consume(found${index}.label);`,
    ).join("\n")}
  `,
).join("\n");

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(["notFound", "redirect", "permanentRedirect"])(
  "canonical Next %s exit proof work bounds",
  (exitName) => {
    it("proves each imported guard once across many aliases and reads", () => {
      const moduleProof = vi.spyOn(importProof, "isValueImportFromModule");
      const result = runRule(
        noArrayFindResultMemberAccessWithoutGuard,
        `import { ${exitName} } from "next/navigation";
       function render(rows) { ${guardedAliasSource.replaceAll("notFound()", `${exitName}("/missing")`)} }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(moduleProof).toHaveBeenCalledTimes(NEXT_NOT_FOUND_PROOF_GUARD_COUNT);
    });

    it("also caches rejected module proofs without suppressing unsafe reads", () => {
      const moduleProof = vi.spyOn(importProof, "isValueImportFromModule");
      const result = runRule(
        noArrayFindResultMemberAccessWithoutGuard,
        `import { ${exitName} } from "other/navigation";
       function render(rows) { ${guardedAliasSource.replaceAll("notFound()", `${exitName}("/missing")`)} }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(
        NEXT_NOT_FOUND_PROOF_GUARD_COUNT * NEXT_NOT_FOUND_PROOF_READS_PER_ALIAS_COUNT,
      );
      expect(moduleProof).toHaveBeenCalledTimes(NEXT_NOT_FOUND_PROOF_GUARD_COUNT);
    });
  },
);
