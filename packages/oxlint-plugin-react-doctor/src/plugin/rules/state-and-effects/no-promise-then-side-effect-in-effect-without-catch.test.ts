import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPromiseThenSideEffectInEffectWithoutCatch } from "./no-promise-then-side-effect-in-effect-without-catch.js";

describe("no-promise-then-side-effect-in-effect-without-catch", () => {
  it("flags an identifier chain bound to an in-file async fetch wrapper with no catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const initEditor = async () => {
        const response = await fetch("/editor");
        return response.json();
      };
      useEffect(() => { const cancelable = initEditor(); cancelable.then((monaco) => { setMonaco(monaco); }); }, []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a direct call chain resolving to an in-file async function that awaits fetch uncaught", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `async function generateThumbnail(clip) {
        const response = await fetch(clip.url);
        return response.blob();
      }
      useEffect(() => { generateThumbnail(clip).then((url) => { setThumbnail(url); }); }, [clip]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a global fetch chain with .finally but no .catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetch(src).then((info) => { setInfo(info); }).finally(() => { setLoading(false); }); }, [src]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a floating dynamic import chain that mutates a ref with no catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { import("./sounds/" + name).then((mod) => { bufferRef.current = mod.default; }); }, [name]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a loaders-map dynamic import wrapper (readme.so language dictionary idiom)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const loaders = { en: () => import("./locales/en.js"), fr: () => import("./locales/fr.js") };
      const loadDict = async (locale) => {
        const loader = loaders[locale];
        const mod = await loader();
        return mod.default;
      };
      useEffect(() => { void loadDict(locale).then((next) => { if (!cancelled) setDict(next); }); }, [locale]);`,
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

  it("does not flag a predicate-style promise from an unresolved callee", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { isImageValid(src).then((ok) => { setStatus(ok ? 'loaded' : 'error'); }); }, [src]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a name-heuristic initiator that is not provably rejectable (error-folding service wrapper)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { getDataFromService(url).then((response) => { setDtypes(response.dtypes); }); }, [url]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an in-file wrapper that try/catches internally and resolves null", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const requestLazyCaptionThumbnail = async (id) => {
        try {
          const response = await fetch("/thumb/" + id);
          return response.blob();
        } catch {
          return null;
        }
      };
      useEffect(() => { requestLazyCaptionThumbnail(id).then((blob) => { setThumbnail(blob); }); }, [id]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the then callback null-guard-returns its argument first (resolve-null contract)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetch(src).then((view) => { if (!view) return; setView(view); }); }, [src]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when every state write is guarded by the callback param (resolve-undefined contract)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetch(src).then((view) => { if (view) { setView(view); } }); }, [src]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the callback reads the response's in-band error field (dtale error-folding contract)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetch(url).then((response) => { if (response?.error) { setError(response.error); return; } setData(response.data); }); }, [url]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag in Storybook story files (designed fallback defaults)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetch(src).then((info) => { setInfo(info); }); }, [src]);`,
      { filename: "widget.stories.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a .then whose only setter-shaped call is the global setTimeout", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetch(configUrl).then((config) => { setTimeout(applyConfig, config.delay); }); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain with a .catch handler", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetch(src).then((i) => setInfo(i)).catch((e) => {}); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain with an onRejected second argument", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetch(url).then((x) => setX(x), (e) => {}); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain wrapped in try/catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { try { fetch(url).then((x) => { setX(x); }); } catch (e) {} }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a .then with no state side effect", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetch(url).then((x) => log(x)); }, []);`,
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

  it("still flags an identifier initiator bound to an uncaught global fetch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => {
        const request = fetch(url);
        void request.then((data) => { setDetail(data); });
      }, [id]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a then that receives the state setter directly (fetch-json-setState idiom)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetch(url).then((response) => response.json()).then(setUser); }, [url]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Promise.all of global fetches with no catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { Promise.all([fetch('/user'), fetch('/posts')]).then(([user, posts]) => { setUser(user); setPosts(posts); }); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag Promise.allSettled (never rejects)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { Promise.allSettled([fetch('/user'), fetch('/posts')]).then((results) => { setResults(results); }); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an identifier bound to an uncaught chained fetch call", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { const parsed = fetch(url).then((response) => response.json()); parsed.then((data) => { setDetail(data); }); }, [url]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an identifier bound to a chain whose upstream already catches", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { const parsed = fetch(url).then((response) => response.json()).catch(() => null); parsed.then((data) => { setDetail(data); }); }, [url]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain outside an effect", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `function handler() { fetch(url).then((x) => { setX(x); }); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
