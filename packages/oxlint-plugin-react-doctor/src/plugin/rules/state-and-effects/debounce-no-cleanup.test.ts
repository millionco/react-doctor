import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { debounceNoCleanup } from "./debounce-no-cleanup.js";

const LODASH_DEBOUNCE_IMPORT = `import { debounce, throttle } from 'lodash';\n`;

describe("debounce-no-cleanup", () => {
  it("flags a useMemo debounce doing async work, driven from an effect, with no cancel cleanup", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          const results = await fetchResults(value);
          setResults(results);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useRef debounce doing DOM work, driven from an effect, with no cancel cleanup", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Input() {
        const debounced = useRef(debounce((value) => {
          document.title = value;
        }, 200));
        useEffect(() => {
          debounced.current(value);
        }, [value]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a throttle variant doing DOM work driven from an effect", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Scroller() {
        const measure = useMemo(() => throttle(() => {
          window.requestAnimationFrame(update);
        }, 100), []);
        useEffect(() => {
          measure();
        }, [measure]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a namespace-imported lodash debounce doing async work driven from an effect", () => {
    const result = runRule(
      debounceNoCleanup,
      `import _ from 'lodash';
      function Search() {
        const search = useMemo(() => _.debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores debounce calls inside uninvoked nested effect helpers", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          const runSearch = () => search(query);
          registerDebugHelper(runSearch);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("tracks debounce calls through invoked nested effect helpers", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          const runSearch = () => search(query);
          runSearch();
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the standalone lodash.debounce package import", () => {
    const result = runRule(
      debounceNoCleanup,
      `import debounce from 'lodash.debounce';
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the lodash-es/debounce subpath import", () => {
    const result = runRule(
      debounceNoCleanup,
      `import debounce from 'lodash-es/debounce';
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a debounced named callback resolved through a same-scope binding", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const runQuery = async (value) => {
          await fetchResults(value);
        };
        const search = useMemo(() => debounce(runQuery, 500), [runQuery]);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when a useEffect cleanup cancels the debounce", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        useEffect(() => () => search.cancel(), [search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag returning the cancel method reference from an effect (lodash cancel handed off uninvoked)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        useEffect(() => search.cancel, [search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag returning the cancel method reference from an effect block", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce } from "lodash";
       function Search() {
         const search = useMemo(() => debounce(runSearch, 250), []);
         useEffect(() => {
           search(query);
           return search.cancel;
         }, [search, query]);
         return null;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag passing the cancel method to react-use's useUnmount", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        useUnmount(search.cancel);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the exhaustive-deps ref-capture cleanup (alias cancelled on unmount)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Input() {
        const debounced = useRef(debounce((value) => {
          document.title = value;
        }, 200));
        useEffect(() => {
          debounced.current(value);
          const fn = debounced.current;
          return () => fn.cancel();
        }, [value]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a custom hook that returns the debounced binding (caller owns the cleanup)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      export function useDebouncedSearch(setQuery) {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), [setQuery]);
        useEffect(() => {
          search(initialQuery);
        }, [search]);
        return search;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a custom hook that returns the binding inside an object", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      export function useDebouncedSearch(setQuery) {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), [setQuery]);
        useEffect(() => {
          search(initialQuery);
        }, [search]);
        return { search };
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a debounced useState-setter commit (a post-unmount setter is a React 18 no-op)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function ColorPicker() {
        const [color, setColor] = useState('#fff');
        const commitColor = useMemo(() => debounce(setColor, 300), []);
        useEffect(() => {
          commitColor(draftColor);
        }, [draftColor, commitColor]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a debounced parent-notification prop callback (benign late callback)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Slider({ onValueChange }) {
        const notifyParent = useMemo(() => debounce((value) => {
          onValueChange(value);
        }, 200), [onValueChange]);
        useEffect(() => {
          notifyParent(value);
        }, [value, notifyParent]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a debounced handler only wired to render event handlers, not an effect", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        return <input onChange={(event) => search(event.target.value)} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an autosave-named debounce where flush, not cancel, is the correct teardown", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Editor({ doc }) {
        const saveDraft = useMemo(() => debounce(async () => {
          await api.putDraft(doc);
        }, 300), [doc]);
        useEffect(() => {
          saveDraft();
        }, [doc, saveDraft]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat async binding names as save-like teardown", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search({ query }) {
        const asyncSearch = useMemo(() => debounce(async () => {
          await fetchResults(query);
        }, 300), [query]);
        useEffect(() => {
          asyncSearch();
        }, [asyncSearch]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a debounced body guarded by a null ref early return (unmount-guarded work)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function HrefPopover() {
        const reposition = useMemo(() => debounce(() => {
          if (!paperRef.current) return;
          window.requestAnimationFrame(update);
        }, 100), []);
        useEffect(() => {
          reposition();
        }, [reposition]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a leading-edge-only debounce with trailing: false", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500, { trailing: false }), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("only trusts statically resolved trailing option keys", () => {
    const dynamicResult = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search() {
         const trailing = "leading";
         const search = useMemo(() => debounce(async (value) => {
           await fetchResults(value);
         }, 250, { [trailing]: false }), []);
         useEffect(() => { search(query); }, [search, query]);
         return null;
       }`,
    );
    const staticResult = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search() {
         const search = useMemo(() => debounce(async (value) => {
           await fetchResults(value);
         }, 250, { ["trailing"]: false }), []);
         useEffect(() => { search(query); }, [search, query]);
         return null;
       }`,
    );
    expect(dynamicResult.diagnostics).toHaveLength(1);
    expect(staticResult.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-lodash custom debounce", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce } from './my-utils';
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a module-scope debounce outside a hook", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      const search = debounce(setQuery, 500);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the debounce result is not assigned to a binding", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        useMemo(() => debounce(setQuery, 500), []);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Hoisted null-ref guard (TS narrowing idiom) instead of inline if-test", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function Popover() {
  const reposition = useMemo(() => debounce(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    window.requestAnimationFrame(() => positionPopover(anchor));
  }, 100), []);
  useEffect(() => {
    reposition();
  }, [reposition]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Guard hoisted via optional-chained measurement before early return", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function Tooltip() {
  const measure = useMemo(() => debounce(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    window.requestAnimationFrame(() => place(rect));
  }, 150), []);
  useEffect(() => {
    measure();
  }, [measure]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Destructured cancel returned as effect cleanup", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function Search() {
  const search = useMemo(() => debounce(async (value) => {
    const results = await fetchResults(value);
    setResults(results);
  }, 500), []);
  useEffect(() => {
    search(query);
    const { cancel } = search;
    return () => cancel();
  }, [query, search]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Cancel-on-unmount through a latest-ref holding the debounced fn", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function Search({ query }) {
  const search = useMemo(() => debounce(async (value) => {
    setResults(await fetchResults(value));
  }, 300), []);
  const searchRef = useRef(search);
  useEffect(() => {
    search(query);
  }, [query, search]);
  useEffect(() => {
    return () => searchRef.current.cancel();
  }, []);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Cancel delegated to a same-file reusable cleanup hook", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

const useCancelOnUnmount = (debounced) => {
  useEffect(() => () => debounced.cancel(), [debounced]);
};
function Search({ query }) {
  const search = useMemo(() => debounce(async (value) => {
    setResults(await fetchResults(value));
  }, 300), []);
  useCancelOnUnmount(search);
  useEffect(() => {
    search(query);
  }, [query, search]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: trailing:false passed via a module-scope options constant", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

const TRACK_OPTIONS = { leading: true, trailing: false };
function Tracker({ position }) {
  const report = useMemo(() => debounce(async (value) => {
    await api.reportScroll(value);
  }, 500, TRACK_OPTIONS), []);
  useEffect(() => {
    report(position);
  }, [position, report]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: useWindowWidth: throttled no-op setter reading window.innerWidth, listener removed on unmount", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function useWindowWidth() {
  const [width, setWidth] = useState(0);
  const handleResize = useMemo(() => throttle(() => {
    setWidth(window.innerWidth);
  }, 100), []);
  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);
  return width;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Callback parameter named `document` (domain noun) in a benign parent-notification debounce", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function DocumentEditor({ document, onDocumentChange }) {
  const notifyChange = useMemo(() => debounce((document) => {
    onDocumentChange(document);
  }, 400), [onDocumentChange]);
  useEffect(() => {
    notifyChange(document);
  }, [document, notifyChange]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Debounced localStorage persistence where the trailing write IS the desired behavior", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function useColumnWidthStorage(columnWidths) {
  const writeWidths = useMemo(() => debounce((widths) => {
    window.localStorage.setItem('table-column-widths', JSON.stringify(widths));
  }, 300), []);
  useEffect(() => {
    writeWidths(columnWidths);
  }, [columnWidths, writeWidths]);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Debounced fire-and-forget analytics with .catch(noop)", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function SearchBox({ query }) {
  const trackSearch = useMemo(() => debounce((value) => {
    analytics.track('search-input', { value }).catch(() => {});
  }, 1000), []);
  useEffect(() => {
    if (query) trackSearch(query);
  }, [query, trackSearch]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a debounced fetch with no cancel anywhere", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce } from 'lodash';
       function Search({ query }) {
         const search = useMemo(() => debounce(async (value) => {
           const results = await fetchResults(value);
           setResults(results);
         }, 500), []);
         useEffect(() => {
           search(query);
         }, [query, search]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a debounced DOM write with no cancel", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce } from 'lodash';
       function Title({ title }) {
         const apply = useMemo(() => debounce((value) => {
           document.title = value;
         }, 300), []);
         useEffect(() => {
           apply(title);
         }, [title, apply]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks computed factories and flow-stable option bindings", () => {
    const mutatedBefore = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       import { useEffect, useMemo } from "react";
       function MutatedBefore({ query }) {
         const options = { trailing: false };
         options.trailing = true;
         const search = useMemo(() => lodash["debounce"](async (value) => {
           await fetchResults(value);
         }, 250, options), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const mutatedAfter = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       import { useEffect, useMemo } from "react";
       function MutatedAfter({ query }) {
         const options = { trailing: false };
         const search = useMemo(() => lodash[\`debounce\`](async (value) => {
           await fetchResults(value);
         }, 250, options), []);
         options.trailing = true;
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const shadowedOptions = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       import { useEffect, useMemo } from "react";
       const outerOptions = { trailing: false };
       function ShadowedOptions({ query }) {
         const outerOptions = { trailing: true };
         const search = useMemo(() => lodash["debounce"](async (value) => {
           await fetchResults(value);
         }, 250, outerOptions), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    expect(mutatedBefore.diagnostics).toHaveLength(1);
    expect(mutatedAfter.diagnostics).toHaveLength(0);
    expect(shadowedOptions.diagnostics).toHaveLength(1);
  });

  it("tracks transparent wrappers around lodash namespace receivers", () => {
    const castNamespace = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }) {
         const search = useMemo(() => (lodash as any).debounce(async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const assertedNamespace = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }) {
         const search = useMemo(() => lodash!.debounce(async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const shadowedNamespace = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }, lodash) {
         const search = useMemo(() => (lodash as any).debounce(async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const unrelatedNamespace = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }) {
         const search = useMemo(() => (custom as any).debounce(async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    expect(castNamespace.diagnostics).toHaveLength(1);
    expect(assertedNamespace.diagnostics).toHaveLength(1);
    expect(shadowedNamespace.diagnostics).toHaveLength(0);
    expect(unrelatedNamespace.diagnostics).toHaveLength(0);
  });

  it("requires the matching computed debounce release", () => {
    const acquireOnly = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }) {
         const search = useMemo(() => lodash["debounce"](async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const matchingRelease = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }) {
         const search = useMemo(() => lodash["debounce"](async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
         useEffect(() => () => search[\`cancel\`](), [search]);
       }`,
    );
    const wrongRelease = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query, other }) {
         const search = useMemo(() => lodash["debounce"](async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
         useEffect(() => () => other[\`cancel\`](), [other]);
       }`,
    );
    expect(acquireOnly.diagnostics).toHaveLength(1);
    expect(matchingRelease.diagnostics).toHaveLength(0);
    expect(wrongRelease.diagnostics).toHaveLength(1);
  });

  it("does not treat a persistent boolean ref as an unmount-cleared DOM ref", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search() {
         const alive = useRef(true);
         const search = useMemo(() => debounce(() => {
           if (!alive.current) return;
           document.title = "late";
         }, 100), []);
         useEffect(() => search(), [search]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a ref parameter as unmount-cleared", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search({ targetRef }) {
         const search = useMemo(() => debounce(() => {
           if (!targetRef.current) return;
           document.title = "late";
         }, 100), [targetRef]);
         useEffect(() => search(), [search]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not suppress DOM work based on a sync-prefixed binding name", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search() {
         const syncPosition = useMemo(() => debounce(() => {
           document.body.scrollTop = 0;
         }, 100), []);
         useEffect(() => syncPosition(), [syncPosition]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats a returned debounce alias as caller-owned cleanup", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function useSearch() {
         const search = useMemo(() => debounce(() => {
           document.title = "late";
         }, 100), []);
         const exposedSearch = search;
         useEffect(() => exposedSearch(), [exposedSearch]);
         return exposedSearch;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("tracks hook calls through transparent type wrappers", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search() {
         const search = (useMemo(() => debounce(() => {
           document.title = "late";
         }, 100), []) as any)!;
         useEffect(() => search(), [search]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
