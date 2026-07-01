import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hookImportRenameLosesUsePrefix } from "./hook-import-rename-loses-use-prefix.js";

describe("hook-import-rename-loses-use-prefix", () => {
  it("flags a useQuery alias that drops the use prefix", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as getProducts } from "@tanstack/react-query";`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useState alias to a lowercase name", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useState as state } from "react";`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags each renamed hook in a multi-specifier import", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useMemo as memoize, useCallback as cb } from "react";`
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a third-party hook rename", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useFormik as formik } from "formik";`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a local-hooks-module hook rename", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useDebouncedValue as debounced } from "./hooks/useDebouncedValue";`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an alias that keeps a valid hook name", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as useProducts } from "@tanstack/react-query";`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the imported name is not a hook", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { makeRequest as getProducts } from "./api";`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a default import (no imported hook name to mismatch)", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import useQuery from "./hooks/useQuery";`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain named import with no rename", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useState } from "react";`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag imported names that fail /^use[A-Z]/", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useless as helper } from "./util";
       import { user as currentUser } from "./m";
       import { used as consumed } from "./flags";`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a local reassignment of a hook (not an import specifier)", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `const useThing = something; const renamed = useThing;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a type-only hook import specifier", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { type useThing as thing } from "./hooks";`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves the alias through an aliased-hook rename that keeps the prefix", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useEffect as runEffect } from "react";`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a test-file hook alias used to wrap for mocking", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useTracking as baseUseTracking } from "react-tracking";`,
      { filename: "src/Apps/Auctions/__tests__/MyBids.jest.tsx" }
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
