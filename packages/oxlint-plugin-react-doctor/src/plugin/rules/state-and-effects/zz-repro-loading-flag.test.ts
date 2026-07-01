import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

describe("repro", () => {
  it("earlier await before truthy set", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        await ensureSession();
        setLoading(true);
        const data = await fetchItems();
        setItems(data);
        setLoading(false);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    console.log("DIAG_EARLIER_AWAIT=" + result.diagnostics.length);
  });
  it("control: no earlier await", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        setLoading(true);
        const data = await fetchItems();
        setItems(data);
        setLoading(false);
      };`,
    );
    console.log("DIAG_CONTROL=" + result.diagnostics.length);
  });
});
