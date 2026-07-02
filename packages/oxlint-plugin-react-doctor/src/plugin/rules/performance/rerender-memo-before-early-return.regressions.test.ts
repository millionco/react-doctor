import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderMemoBeforeEarlyReturn } from "./rerender-memo-before-early-return.js";

describe("performance/rerender-memo-before-early-return — regressions", () => {
  it("stays silent when the early return uses the memoized value", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `function C({ cond }) { const content = useMemo(() => <Heavy />, []); if (cond) { return content; } return <div>{content}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags when the early return ignores the memoized value", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `function C({ cond }) { const content = useMemo(() => <Heavy />, []); if (cond) { return null; } return <div>{content}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on the mined ant-design CodePreviewer shape: memo consumed transitively, early return uses the intermediate", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `
const CodePreviewer = ({ iframe, version, children }) => {
  const iframePreview = useMemo(() => {
    if (!iframe) {
      return null;
    }
    return (
      <BrowserFrame>
        <iframe src="x" title="demo" />
      </BrowserFrame>
    );
  }, [iframe]);

  const previewContent = iframePreview ?? children;

  const codeBox = <section>{previewContent}</section>;

  if (version) {
    return <Ribbon text={version}>{codeBox}</Ribbon>;
  }

  return codeBox;
};
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a transitive-consumer chain when the early return references nothing in the chain", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `
const Panel = ({ loading, children }) => {
  const preview = useMemo(() => <Heavy />, []);
  const framed = <section>{preview}</section>;
  if (loading) {
    return <Spinner />;
  }
  return framed;
};
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a paren-wrapped JSX return inside the memo callback when the early return bails without it", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `function C({ cond }) { const content = useMemo(() => { return (<Heavy />); }, []); if (cond) { return null; } return <div>{content}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a paren-wrapped arrow-body memo callback when the early return bails without it", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `function C({ cond }) { const content = useMemo(() => (<Heavy />), []); if (cond) { return null; } return <div>{content}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a paren-wrapped early return argument references the memoized value", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `function C({ cond }) { const content = useMemo(() => { return (<Heavy />); }, []); if (cond) { return (content); } return <div>{content}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
