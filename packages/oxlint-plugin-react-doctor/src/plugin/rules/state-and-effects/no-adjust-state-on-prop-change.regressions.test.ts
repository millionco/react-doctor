import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("no-adjust-state-on-prop-change — regressions", () => {
  it("flags constant resets in a transition effect with a setTimeout sibling (lobe-ui FloatingSheet)", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function FloatingSheet({ isOpen }) {
        const [isClosing, setIsClosing] = useState(false);
        const [isAnimating, setIsAnimating] = useState(false);
        const [height, setHeight] = useState(0);
        useEffect(() => {
          if (isOpen) {
            setIsClosing(false);
            setIsAnimating(true);
            setHeight(0);
            setTimeout(() => setIsAnimating(false), 300);
          }
        }, [isOpen]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a literal reset even when the cleanup also calls the setter", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function List({ items }) {
        const [selection, setSelection] = useState();
        useEffect(() => {
          setSelection(null);
          return () => setSelection(undefined);
        }, [items]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a literal reset beside a timer-callback setter", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function List({ items }) {
        const [selection, setSelection] = useState();
        const [flash, setFlash] = useState(false);
        useEffect(() => {
          setSelection(null);
          setTimeout(() => setFlash(true), 100);
        }, [items]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a constant setter with no async sibling (upstream invalid shape)", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function List({ items }) {
        const [selection, setSelection] = useState();
        useEffect(() => {
          setSelection(null);
        }, [items]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare .current read on a non-ref data object", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Table({ pageSize }) {
        const pagination = usePaginationStore();
        const [page, setPage] = useState(1);
        useEffect(() => {
          setPage(pagination.current);
        }, [pageSize]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on the async fetch signature (.then flow) with a sync setLoading toggle", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Results({ query }) {
        const [loading, setLoading] = useState(false);
        const [data, setData] = useState(null);
        useEffect(() => {
          setLoading(true);
          fetchResults(query).then((result) => {
            setData(result);
            setLoading(false);
          });
        }, [query]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the async fetch signature (await in an async IIFE)", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Results({ query }) {
        const [loading, setLoading] = useState(false);
        const [data, setData] = useState(null);
        useEffect(() => {
          setLoading(true);
          (async () => {
            const result = await fetchResults(query);
            setData(result);
            setLoading(false);
          })();
        }, [query]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a DOM measurement re-triggered by a prop", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Box({ visible }) {
        const ref = useRef(null);
        const [mobile, setMobile] = useState(false);
        useEffect(() => {
          if (ref.current) setMobile(ref.current.offsetWidth < 600);
        }, [visible]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
