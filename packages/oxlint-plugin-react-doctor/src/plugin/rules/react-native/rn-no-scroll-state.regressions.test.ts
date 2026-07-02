import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoScrollState } from "./rn-no-scroll-state.js";

describe("react-native/rn-no-scroll-state — regressions", () => {
  it("stays silent on a guarded set-once latch reading the same state", () => {
    const result = runRule(
      rnNoScrollState,
      `const C = () => {
  const [hasScrolled, setHasScrolled] = useState(false);
  const onScroll = () => { if (!hasScrolled) setHasScrolled(true); };
  return <ScrollView onScroll={onScroll} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a ref-guarded set-once latch", () => {
    const result = runRule(
      rnNoScrollState,
      `const C = () => {
  const [hasScrolled, setHasScrolled] = useState(false);
  const hasScrolledRef = useRef(false);
  const handleScroll = () => {
    if (!hasScrolledRef.current) {
      hasScrolledRef.current = true;
      setHasScrolled(true);
    }
  };
  return <ScrollView onScroll={handleScroll} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a different-value per-frame setState guard", () => {
    const result = runRule(
      rnNoScrollState,
      `const C = () => {
  const [showShadow, setShowShadow] = useState(false);
  const handleScroll = (offset) => { if (offset > 100) setShowShadow(true); };
  return <ScrollView onScroll={handleScroll} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags unconditional per-frame setState", () => {
    const result = runRule(
      rnNoScrollState,
      `const C = () => {
  const [y, setY] = useState(0);
  const onScroll = (e) => { setY(e.nativeEvent.contentOffset.y); };
  return <ScrollView onScroll={onScroll} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a both-branch if/else toggle of the same state", () => {
    const result = runRule(
      rnNoScrollState,
      `const C = () => {
  const [showHeader, setShowHeader] = useState(true);
  const onScroll = (e) => {
    if (showHeader) { setShowHeader(false); } else { setShowHeader(true); }
  };
  return <ScrollView onScroll={onScroll} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a both-arm ternary toggle of the same state", () => {
    const result = runRule(
      rnNoScrollState,
      `const C = () => {
  const [showHeader, setShowHeader] = useState(true);
  const onScroll = () => { showHeader ? setShowHeader(false) : setShowHeader(true); };
  return <ScrollView onScroll={onScroll} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a toggle written as setX(x ? a : b)", () => {
    const result = runRule(
      rnNoScrollState,
      `const C = () => {
  const [showHeader, setShowHeader] = useState(true);
  const onScroll = () => { setShowHeader(showHeader ? false : true); };
  return <ScrollView onScroll={onScroll} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot: a guard that reads the same state but writes a CHANGING value is a
  // per-frame sync, not a set-once latch — the literal-flip requirement keeps
  // it reported.
  it("still flags a same-state guard that writes a changing value every frame", () => {
    const result = runRule(
      rnNoScrollState,
      `const C = () => {
  const [lastOffset, setLastOffset] = useState(0);
  const onScroll = (offset) => { if (offset !== lastOffset) setLastOffset(offset); };
  return <ScrollView onScroll={onScroll} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
