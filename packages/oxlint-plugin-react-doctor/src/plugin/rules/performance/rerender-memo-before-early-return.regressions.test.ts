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

  // FP anchor (shadcn field.tsx FieldError): the early-return TEST reads
  // the memo value — the memo must run to decide the bailout, so nothing
  // is wasted.
  it("stays silent when the early-return condition reads the memoized value", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `
function FieldError({ children, errors }) {
  const content = useMemo(() => {
    if (children) {
      return children;
    }
    if (!errors?.length) {
      return null;
    }
    return <ul>{errors.map((error, index) => <li key={index}>{error.message}</li>)}</ul>;
  }, [children, errors]);

  if (!content) {
    return null;
  }

  return <div role="alert">{content}</div>;
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // FP anchor (AppFlowy ViewItem): the memo callback's leading guard
  // repeats the component's bailout condition, so a bailout render pays a
  // single comparison, not the JSX build.
  it("stays silent when the callback's leading guard mirrors the early-return test", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `
function ViewItem({ view, aiEnabled }) {
  const renderItem = useMemo(() => {
    if (!view) return null;
    if (!aiEnabled && view.layout === ViewLayout.AIChat) return null;
    return <div data-testid={view.view_id}><Heavy view={view} /></div>;
  }, [view, aiEnabled]);

  if (!aiEnabled && view.layout === ViewLayout.AIChat) return null;

  return <div>{renderItem}</div>;
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags when the callback guard differs from the early-return test", () => {
    const result = runRule(
      rerenderMemoBeforeEarlyReturn,
      `
function Panel({ view, loading }) {
  const content = useMemo(() => {
    if (!view) return null;
    return <Heavy view={view} />;
  }, [view]);

  if (loading) return <Spinner />;

  return <div>{content}</div>;
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
