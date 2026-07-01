import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSettimeoutSetstateWithoutCleanup } from "./no-settimeout-setstate-without-cleanup.js";

describe("no-settimeout-setstate-without-cleanup", () => {
  it("flags an event-handler toast reset with no captured id", () => {
    const result = runRule(
      noSettimeoutSetstateWithoutCleanup,
      `const onCopy = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a hook-body status flag reset", () => {
    const result = runRule(
      noSettimeoutSetstateWithoutCleanup,
      `useCopyToClipboard(() => { setState('idle'); setTimeout(() => setState('copied'), 1500); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a self-clearing success message", () => {
    const result = runRule(
      noSettimeoutSetstateWithoutCleanup,
      `const onSubmit = async () => { setSuccess('Password updated successfully.'); setTimeout(() => setSuccess(null), 3000); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an uncaptured window.setTimeout state setter", () => {
    const result = runRule(
      noSettimeoutSetstateWithoutCleanup,
      `const onOpen = () => { window.setTimeout(() => setOpen(true), 200); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an id captured to a ref and cleared elsewhere", () => {
    const result = runRule(
      noSettimeoutSetstateWithoutCleanup,
      `const C = () => { const timerRef = useRef(); const open = () => { timerRef.current = window.setTimeout(() => setOpen(true), 200); }; const close = () => clearTimeout(timerRef.current); return null; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an id assigned to a variable", () => {
    const result = runRule(
      noSettimeoutSetstateWithoutCleanup,
      `const onEdit = () => { const id = setTimeout(() => setDirty(false), 500); return id; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a setTimeout inside a useEffect with clearTimeout cleanup", () => {
    const result = runRule(
      noSettimeoutSetstateWithoutCleanup,
      `const C = () => { useEffect(() => { const id = setTimeout(() => setReady(true), 100); return () => clearTimeout(id); }, []); return null; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a timeout whose callback does no state update", () => {
    const result = runRule(
      noSettimeoutSetstateWithoutCleanup,
      `const onX = () => { setTimeout(() => doThing(), 1000); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when clearTimeout exists elsewhere in the component scope", () => {
    const result = runRule(
      noSettimeoutSetstateWithoutCleanup,
      `const C = () => { const onCopy = () => { setTimeout(() => setCopied(false), 2000); }; const reset = () => clearTimeout(timer); return null; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a setTimeout outside any function", () => {
    const result = runRule(
      noSettimeoutSetstateWithoutCleanup,
      `setTimeout(() => setCopied(false), 2000);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
