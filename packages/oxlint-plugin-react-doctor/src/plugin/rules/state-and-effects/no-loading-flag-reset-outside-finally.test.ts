import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

describe("no-loading-flag-reset-outside-finally", () => {
  it("flags a trailing reset with no try/catch at all", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        setIsLoading(true);
        const result = await getTrashPaginated(page, perPage);
        setItems(result.items);
        setIsLoading(false);
      };`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a reset after a try/catch that does not reset the flag", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `async function fetchNetworkAnalysis() {
        setLoading(true);
        try {
          const data = await load(dataId);
          setResult(data);
        } catch (e) {
          setError(e);
        }
        setLoading(false);
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a submit handler that resets only after the awaited mutation", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const onSubmit = async () => {
        setSubmitting(true);
        await savePlugin(values);
        onClose();
        setSubmitting(false);
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the reset is mirrored in the catch", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const search = async (query) => {
        setLoading(true);
        try {
          const res = await autocomplete(query);
          setResults(res);
          setLoading(false);
        } catch (e) {
          setLoading(false);
          reportError(e);
        }
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the reset is in a finally", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const submit = async () => {
        setSubmitting(true);
        try {
          await placeBid(input);
        } finally {
          setSubmitting(false);
        }
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a non-loading boolean toggle", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const toggle = async () => {
        setOpen(true);
        await animate();
        setOpen(false);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when there is no await between set and reset", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = () => {
        setLoading(true);
        doWork();
        setLoading(false);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a nested callback reset as this scope's reset", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        setLoading(true);
        await fetchThings();
        subscribe(() => {
          setLoading(false);
        });
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the reset happens before the await", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        setLoading(true);
        setLoading(false);
        await fetchThings();
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
