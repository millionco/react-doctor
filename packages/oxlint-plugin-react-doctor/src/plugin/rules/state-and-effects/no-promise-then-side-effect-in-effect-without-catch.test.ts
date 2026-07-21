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
      const [, setMonaco] = useState(null);
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
      const [, setThumbnail] = useState(null);
      useEffect(() => { generateThumbnail(clip).then((url) => { setThumbnail(url); }); }, [clip]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a global fetch chain with .finally but no .catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setInfo] = useState(null);
      useEffect(() => { fetch(src).then((info) => { setInfo(info); }).finally(() => { setLoading(false); }); }, [src]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a floating dynamic import chain that mutates a ref with no catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const bufferRef = useRef(null);
      useEffect(() => { import("./sounds/" + name).then((mod) => { bufferRef.current = mod.default; }); }, [name]);`,
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
      const [, setDict] = useState(null);
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
      const [, setThumbnail] = useState(null);
      useEffect(() => { requestLazyCaptionThumbnail(id).then((blob) => { setThumbnail(blob); }); }, [id]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an in-file wrapper whose catch throws a fresh error", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const requestThumbnail = async (id) => {
        try {
          return await fetch("/thumb/" + id);
        } catch {
          throw new Error("thumbnail failed");
        }
      };
      const [, setThumbnail] = useState(null);
      useEffect(() => { requestThumbnail(id).then(setThumbnail); }, [id]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("does not flag a terminal catch whose concise handler sets error state", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setInfo] = useState(null); const [, setError] = useState(null);
      useEffect(() => {
        fetch(src).then((response) => response.json()).then(setInfo).catch((error) => setError(error));
      }, [src]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a terminal catch whose concise handler logs the error", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setInfo] = useState(null);
      useEffect(() => { fetch(src).then(setInfo).catch((error) => console.error(error)); }, [src]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust unknown console methods or a reassigned state dispatcher", () => {
    const sources = [
      `const [, setInfo] = useState(null);
       useEffect(() => {
         fetch(src).then(setInfo).catch((error) => console.missing(error));
       }, [src]);`,
      `const [, setInfo] = useState(null);
       useEffect(() => {
         fetch(src).then(setInfo).catch((error) => console[method](error));
       }, [src, method]);`,
      `let [, setError] = useState(null);
       const [, setInfo] = useState(null);
       setError = () => { throw new Error("failed"); };
       useEffect(() => {
         fetch(src).then(setInfo).catch((error) => setError(error));
       }, [src]);`,
    ];
    for (const source of sources) {
      expect(runRule(noPromiseThenSideEffectInEffectWithoutCatch, source).diagnostics).toHaveLength(
        1,
      );
    }
  });

  it("does not flag a catch handler that returns a fulfilled promise", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setInfo] = useState(null);
      useEffect(() => {
        fetch(src).then(setInfo).catch(() => Promise.resolve(null));
      }, [src]);`,
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

  it("does not mistake synchronous try/catch for promise rejection handling", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = () => {
        const [, setX] = useState(null);
        useEffect(() => { try { fetch(url).then((x) => { setX(x); }); } catch (e) {} }, []);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not mistake returning a promise from try for handling its rejection", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = () => {
        const [, setX] = useState(null);
        const load = () => { try { return fetch(url); } catch { return Promise.resolve(null); } };
        useEffect(() => { load().then(setX); }, []);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
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
      `const [, setDetail] = useState(null);
      useEffect(() => {
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
      `const [, setDetail] = useState(null);
      useEffect(() => {
        const request = fetch(url);
        void request.then((data) => { setDetail(data); });
      }, [id]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unobserved chain stored in a declaration", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setDetail] = useState(null);
      useEffect(() => {
        const request = fetch(url).then((data) => { setDetail(data); });
      }, [url]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a stored chain whose rejection is handled later", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setDetail] = useState(null);
      useEffect(() => {
        const request = fetch(url).then((data) => { setDetail(data); });
        request.catch(() => { setDetail(null); });
      }, [url]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a stored chain whose rejection is handled through a stable alias", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setDetail] = useState(null);
      useEffect(() => {
        const request = fetch(url).then((data) => { setDetail(data); });
        const observedRequest = request;
        observedRequest.catch(() => { setDetail(null); });
      }, [url]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a stored chain with a stable local state-handler alias", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setDetail] = useState(null);
      useEffect(() => {
        const request = fetch(url).then((data) => { setDetail(data); });
        const recover = (error) => { setDetail(null); };
        request.catch(recover);
      }, [url]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag state handlers returning known non-thenable values", () => {
    const sources = [
      `const [, setDetail] = useState(null);
       useEffect(() => {
         const request = fetch(url).then((data) => { setDetail(data); });
         request.catch(() => { setDetail(null); return undefined; });
       }, [url]);`,
      `const [, setDetail] = useState(null);
       useEffect(() => {
         const fallback = null;
         const request = fetch(url).then((data) => { setDetail(data); });
         request.catch(() => { setDetail(null); return fallback; });
       }, [url]);`,
    ];
    for (const source of sources) {
      expect(runRule(noPromiseThenSideEffectInEffectWithoutCatch, source).diagnostics).toHaveLength(
        0,
      );
    }
  });

  it("does not treat reassigned, shadowed, or custom catch values as rejection handlers", () => {
    const sources = [
      `const [, setDetail] = useState(null);
       useEffect(() => {
         const request = fetch(url).then((data) => { setDetail(data); });
         let observedRequest = request;
         observedRequest = { catch: () => {} };
         observedRequest.catch(() => {});
       }, [url]);`,
      `const [, setDetail] = useState(null);
       useEffect(() => {
         const request = fetch(url).then((data) => { setDetail(data); });
         { const request = { catch: (handler) => handler() }; request.catch(() => {}); }
       }, [url]);`,
      `const [, setDetail] = useState(null);
       useEffect(() => {
         const request = fetch(url).then((data) => { setDetail(data); });
         const observer = { catch: (handler) => handler() };
         observer.catch(() => {});
       }, [url]);`,
      `const [, setDetail] = useState(null);
       const recover = (error) => { setDetail(null); };
       useEffect(() => {
         const request = fetch(url).then((data) => { setDetail(data); });
         { const recover = () => { throw new Error("failed"); }; request.catch(recover); }
       }, [url]);`,
      `const [, setDetail] = useState(null);
       useEffect(() => {
         const request = fetch(url).then((data) => { setDetail(data); });
         request.catch((error) => { setDetail(null); return error; });
       }, [url]);`,
    ];
    for (const source of sources) {
      expect(runRule(noPromiseThenSideEffectInEffectWithoutCatch, source).diagnostics).toHaveLength(
        1,
      );
    }
  });

  it("flags a then that receives the state setter directly (fetch-json-setState idiom)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setUser] = useState(null);
      useEffect(() => { fetch(url).then((response) => response.json()).then(setUser); }, [url]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Promise.all of global fetches with no catch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setUser] = useState(null);
      const [, setPosts] = useState(null);
      useEffect(() => { Promise.all([fetch('/user'), fetch('/posts')]).then(([user, posts]) => { setUser(user); setPosts(posts); }); }, []);`,
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
      `const [, setDetail] = useState(null);
      useEffect(() => { const parsed = fetch(url).then((response) => response.json()); parsed.then((data) => { setDetail(data); }); }, [url]);`,
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

  it("stays quiet: Logical-AND param guard (`view && setView(view)`)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => { fetch(src).then((view) => { view && setView(view); }); }, [src]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Null guard combined with cancellation flag (`if (!view || cancelled) return`)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setRows] = useState([]);
      useEffect(() => {
  let cancelled = false;
  fetch(src).then((view) => {
    if (!view || cancelled) return;
    setView(view);
  });
  return () => { cancelled = true; };
}, [src]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Negated `.ok` early return (`if (!response.ok) return; setAvailable(true)`)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setRows] = useState([]);
      useEffect(() => {
  fetch(statusUrl).then((response) => {
    if (!response.ok) return;
    setAvailable(true);
  });
}, [statusUrl]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Destructured then-param error folding (`({ data, error })`)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => {
  fetch(url).then((response) => response.json()).then(({ data, error }) => {
    if (error) { setError(error); return; }
    setData(data);
  });
}, [url]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: GraphQL plural `result.errors` folding", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const runQuery = async (query) => {
  const response = await fetch("/graphql", { method: "POST", body: JSON.stringify({ query }) });
  return response.json();
};
useEffect(() => {
  runQuery(query).then((result) => {
    if (result.errors) { setErrors(result.errors); return; }
    setData(result.data.viewer);
  });
}, [query]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Non-React `set*`-named DOM helper in a dynamic-import then", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const setDocumentTitle = (title) => { document.title = title; };
useEffect(() => {
  import("./page-meta.js").then((mod) => { setDocumentTitle(mod.pageTitle); });
}, []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Richer null-or-empty param guard (`rows == null || rows.length === 0`)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => {
  fetch(url).then((response) => response.json()).then((rows) => {
    if (rows == null || rows.length === 0) return;
    setRows(rows);
  });
}, [url]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Nested cancelled-then-null-guard spelling", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => {
  let cancelled = false;
  fetch(src).then((data) => {
    if (!cancelled) {
      if (!data) return;
      setData(data);
    }
  });
  return () => { cancelled = true; };
}, [src]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Dynamic-import then guarded by null check + mounted ref", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => {
  import("./i18n/" + locale + ".js").then((mod) => {
    if (mod == null || !mountedRef.current) return;
    setMessages(mod.default);
  });
}, [locale]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Optional-chained ok guard early return (`if (!response?.ok) return`)", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `useEffect(() => {
  fetch(healthUrl).then((response) => {
    if (!response?.ok) return;
    setHealthy(true);
  });
}, [healthUrl]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an unguarded setter in a then over raw fetch", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setRows] = useState([]);
      useEffect(() => {
         fetch(url).then((response) => response.json()).then((data) => {
           setRows(data);
         });
       }, [url]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the only guard references an unrelated variable", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const [, setRows] = useState([]);
      useEffect(() => {
         fetch(url).then((data) => {
           if (!enabled) return;
           setRows(data);
         });
       }, [url, enabled]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("no-promise-then-side-effect-in-effect-without-catch audit regressions", () => {
  it("flags an unhandled chain stored through an assignment", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = () => {
        const [, setValue] = useState();
        useEffect(() => {
          let request;
          request = fetch("/x").then((value) => setValue(value));
        }, []);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a singly assigned chain whose rejection is handled later", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = () => {
        const [, setValue] = useState();
        useEffect(() => {
          let request;
          request = fetch("/x").then((value) => setValue(value));
          request.catch(() => setValue(null));
        }, []);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not attach a later catch to an earlier assigned chain", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = () => {
        const [, setValue] = useState();
        useEffect(() => {
          let request;
          request = fetch("/first").then((value) => setValue(value));
          request = Promise.resolve(null);
          request.catch(() => setValue(null));
        }, []);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat conditional or deferred catch attachment as covering an assignment", () => {
    const invalidSources = [
      `const C = ({ shouldObserve }) => {
        const [, setValue] = useState();
        useEffect(() => {
          let request;
          request = fetch("/x").then((value) => setValue(value));
          if (shouldObserve) request.catch(() => setValue(null));
        }, [shouldObserve]);
      };`,
      `const C = () => {
        const [, setValue] = useState();
        useEffect(() => {
          let request;
          request = fetch("/x").then((value) => setValue(value));
          queueMicrotask(() => request.catch(() => setValue(null)));
        }, []);
      };`,
      `const C = ({ shouldObserve }) => {
        const [, setValue] = useState();
        useEffect(() => {
          const request = fetch("/x").then((value) => setValue(value));
          if (shouldObserve) request.catch(() => setValue(null));
        }, [shouldObserve]);
      };`,
    ];
    for (const source of invalidSources) {
      expect(runRule(noPromiseThenSideEffectInEffectWithoutCatch, source).diagnostics).toHaveLength(
        1,
      );
    }
  });

  it("does not let one post-loop catch cover promises assigned across iterations", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = ({ urls }) => {
        const [, setValue] = useState();
        useEffect(() => {
          let request;
          for (const url of urls) {
            request = fetch(url).then((value) => setValue(value));
          }
          request.catch(() => setValue(null));
        }, [urls]);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an assigned chain handled during the same loop iteration", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = ({ urls }) => {
        const [, setValue] = useState();
        useEffect(() => {
          let request;
          for (const url of urls) {
            request = fetch(url).then((value) => setValue(value));
            request.catch(() => setValue(null));
          }
        }, [urls]);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires rejection handlers to avoid potentially throwing member reads", () => {
    const invalidSources = [
      `const C = ({ source }) => {
        const [, setValue] = useState();
        useEffect(() => {
          fetch("/x").then(setValue, () => console.log(source.throwingGetter));
        }, [source]);
      };`,
      `const C = ({ source }) => {
        const [, setValue] = useState();
        useEffect(() => {
          fetch("/x").then(setValue).catch(() => { setValue(source.throwingGetter); });
        }, [source]);
      };`,
    ];
    for (const source of invalidSources) {
      expect(runRule(noPromiseThenSideEffectInEffectWithoutCatch, source).diagnostics).toHaveLength(
        1,
      );
    }
  });

  it("accepts rejection handlers with simple non-throwing arguments", () => {
    const validSources = [
      `const C = () => {
        const [, setValue] = useState();
        useEffect(() => {
          fetch("/x").then(setValue, (error) => console.log(error));
        }, []);
      };`,
      `const C = () => {
        const [, setValue] = useState();
        const fallback = "failed";
        useEffect(() => {
          fetch("/x").then(setValue).catch(() => { console.error(fallback); setValue(null); });
        }, [fallback]);
      };`,
      `const C = () => {
        const [, setValue] = useState();
        useEffect(() => {
          fetch("/x").then(setValue).catch(() => Promise.resolve(null));
        }, []);
      };`,
    ];
    for (const source of validSources) {
      expect(runRule(noPromiseThenSideEffectInEffectWithoutCatch, source).diagnostics).toHaveLength(
        0,
      );
    }
  });

  it("requires a callable, non-rethrowing rejection handler", () => {
    const invalidSources = [
      `const C = () => { const [, setValue] = useState(); useEffect(() => { fetch("/x").then(setValue).catch(); }, []); };`,
      `const C = () => { const [, setValue] = useState(); useEffect(() => { fetch("/x").then(setValue).catch(undefined); }, []); };`,
      `const C = () => { const [, setValue] = useState(); useEffect(() => { fetch("/x").then(setValue, undefined); }, []); };`,
      `const C = () => { const [, setValue] = useState(); useEffect(() => { try { fetch("/x").then(setValue); } catch {} }, []); };`,
      `const C = () => { const [, setValue] = useState(); useEffect(() => { fetch("/x").then((response) => { if (response.ok) setValue(response); }); }, []); };`,
      `const C = () => { const [, setValue] = useState(); const apply = (value) => setValue(value); useEffect(() => { fetch("/x").then(apply); }, []); };`,
      `const C = () => { const [, setValue] = useState(); useEffect(() => fetch("/x").then(setValue), []); };`,
      `const C = () => { const [, setValue] = useState(); useEffect(() => { fetch("/x").then(setValue).catch((error) => { throw error; }); }, []); };`,
      `const C = () => { const [, setValue] = useState(); useEffect(() => { fetch("/x").then(setValue).catch(() => fetch("/fallback")); }, []); };`,
    ];
    for (const source of invalidSources) {
      expect(runRule(noPromiseThenSideEffectInEffectWithoutCatch, source).diagnostics).toHaveLength(
        1,
      );
    }
  });

  it("ignores deferred closures and non-React local side effects", () => {
    const deferredClosure = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = () => { const [, setValue] = useState(); useEffect(() => { fetch("/x").then((value) => () => setValue(value)); }, []); };`,
    );
    const localFunction = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = () => { const setDocumentTitle = (value) => { document.title = value; }; useEffect(() => { fetch("/x").then(setDocumentTitle); }, []); };`,
    );
    expect(deferredClosure.diagnostics).toHaveLength(0);
    expect(localFunction.diagnostics).toHaveLength(0);
  });

  it("does not analyze a reassigned promise helper from its initializer", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = () => { const [, setValue] = useState(); let load = async () => fetch("/value"); load = async () => null; useEffect(() => { load().then(setValue); }, []); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a reassigned rejection handler initializer", () => {
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = () => { const [, setValue] = useState(); let recover = () => null; recover = () => { throw new Error("failed"); }; useEffect(() => { fetch("/value").catch(recover).then(setValue); }, []); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not choose an arbitrary object property for a dynamic promise helper lookup", () => {
    const dynamicLookup = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = ({ helperName }) => { const [, setValue] = useState(); const helpers = { safe: () => Promise.resolve(null), unsafe: async () => fetch("/value") }; const load = helpers[helperName]; useEffect(() => { load().then(setValue); }, [load]); };`,
    );
    const staticLookup = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      `const C = () => { const [, setValue] = useState(); const helpers = { safe: () => Promise.resolve(null), unsafe: async () => fetch("/value") }; const load = helpers["unsafe"]; useEffect(() => { load().then(setValue); }, [load]); };`,
    );
    expect(dynamicLookup.diagnostics).toHaveLength(0);
    expect(staticLookup.diagnostics).toHaveLength(1);
  });
});
