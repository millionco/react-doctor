import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { debounceNoCleanup } from "./debounce-no-cleanup.js";

const LODASH_DEBOUNCE_IMPORT = `import { debounce, throttle } from 'lodash';\n`;

describe("debounce-no-cleanup", () => {
  it("flags a useMemo debounce with no cancel cleanup", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(setQuery, 500), [setQuery]);
        return null;
      }`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useRef debounce with no cancel cleanup", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Input() {
        const debounced = useRef(debounce(() => onChange(), 200));
        return null;
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a throttle variant", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Scroller() {
        const onScroll = useMemo(() => throttle(handle, 100), [handle]);
        return null;
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a namespace-imported lodash debounce", () => {
    const result = runRule(
      debounceNoCleanup,
      `import _ from 'lodash';
      function Search() {
        const search = useMemo(() => _.debounce(setQuery, 500), []);
        return null;
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when a useEffect cleanup cancels the debounce", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(setQuery, 500), [setQuery]);
        useEffect(() => () => search.cancel(), [search]);
        return null;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useRef debounce cancelled via .current", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Input() {
        const debounced = useRef(debounce(() => onChange(), 200));
        useEffect(() => () => debounced.current.cancel(), []);
        return null;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a leading-edge-only debounce with trailing: false", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(setQuery, 500, { trailing: false }), []);
        return null;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-lodash custom debounce", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce } from './my-utils';
      function Search() {
        const search = useMemo(() => debounce(setQuery, 500), []);
        return null;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a module-scope debounce outside a hook", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      const search = debounce(setQuery, 500);`
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
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
