import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";

describe("isProvenUnmodifiedGlobalNamespaceReference metadata policy", () => {
  it.each(["", "Object.defineProperty(Promise, 'name', { get() { return this; } });"])(
    "requires all-member proof before accepting metadata reads: %s",
    (metadataMutation) => {
      const parsed = parseFixture(`${metadataMutation} const labels = [Promise.name]; Promise;`);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const namespaceReference = scopes.rootScope.references.find(
        (reference) =>
          isNodeOfType(reference.identifier, "Identifier") &&
          reference.identifier.name === "Promise",
      )?.identifier;
      if (!namespaceReference) throw new Error("Missing global Promise reference");

      expect(
        isProvenUnmodifiedGlobalNamespaceReference(
          namespaceReference,
          "Promise",
          scopes,
          undefined,
          true,
        ),
      ).toBe(metadataMutation === "");
      expect(
        isProvenUnmodifiedGlobalNamespaceReference(
          namespaceReference,
          "Promise",
          scopes,
          "resolve",
          true,
        ),
      ).toBe(false);
    },
  );
});
