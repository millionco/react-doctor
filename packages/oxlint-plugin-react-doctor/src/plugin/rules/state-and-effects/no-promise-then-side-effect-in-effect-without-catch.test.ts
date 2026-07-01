import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPromiseThenSideEffectInEffectWithoutCatch } from "./no-promise-then-side-effect-in-effect-without-catch.js";

describe("no-promise-then-side-effect-in-effect-without-catch", () => {
  it("flags a resolved loader chain that sets state with no catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { const cancelable = loader.init(); cancelable.then((monaco) => { setMonaco(monaco); }); }, []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a direct async call chain that sets state with no catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { generateThumbnail(clip).then((url) => { setThumbnail(url); }); }, [clip]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chain with .finally but no .catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetchMediaInfo(src).then((info) => { setInfo(info); }).finally(() => { setLoading(false); }); }, [src]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a floating chain that mutates a ref with no catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { loadSound(name).then((buffer) => { bufferRef.current = buffer; }); }, [name]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a Promise.resolve microtask defer", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { Promise.resolve().then(() => { setFocused(true); }); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain whose initiator is not a call", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { element.getAnimations()[0]?.finished.then(() => { setStatus('idle'); }); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a predicate-style promise", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { isImageValid(src).then((ok) => { setStatus(ok ? 'loaded' : 'error'); }); }, [src]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain with a .catch handler", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetchMediaInfo(src).then((i) => setInfo(i)).catch((e) => {}); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain with an onRejected second argument", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetchThing().then((x) => setX(x), (e) => {}); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain wrapped in try/catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { try { fetchThing().then((x) => { setX(x); }); } catch (e) {} }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a .then with no state side effect", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetchThing().then((x) => log(x)); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a re-read of a ref-held cached promise (creation site owns the catch)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => {
        let cancelled = false;
        const inFlight = inFlightRef.current.get(cacheKey);
        void inFlight.then((exists) => { if (!cancelled) setRouteViewExists(exists); });
        return () => { cancelled = true; };
      }, [cacheKey]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an identifier initiator bound to an uncaught real async call", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => {
        const request = loadArtifact(id);
        void request.then((data) => { setDetail(data); });
      }, [id]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a chain outside an effect", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `function handler() { fetchThing().then((x) => { setX(x); }); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
