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
});
