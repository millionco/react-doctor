import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRenderPropChildren } from "./no-render-prop-children.js";

describe("architecture/no-render-prop-children regressions", () => {
  // react-pdf forwards `renderMode` (a 'canvas' | 'svg' | … mode string),
  // `renderTextLayerProps` and `renderAnnotationLayerProps` (layer config bags).
  // None of them are render slots, so the element is not render-prop proliferation.
  it("does not count `render*Props` config bags or a `renderMode` mode prop", () => {
    const { diagnostics } = runRule(
      noRenderPropChildren,
      `
        const Page = () => (
          <PageChildren
            renderMode={renderMode}
            renderTextLayerProps={renderTextLayerProps}
            renderAnnotationLayerProps={renderAnnotationLayerProps}
          />
        );
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("does not count literal-valued `render*` props (mode/flag, not a render slot)", () => {
    const { diagnostics } = runRule(
      noRenderPropChildren,
      `
        const View = () => (
          <Widget renderMode="canvas" renderInline={true} renderDepth={2} />
        );
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags 3+ genuine render-slot props", () => {
    const { diagnostics } = runRule(
      noRenderPropChildren,
      `
        const Panel = () => (
          <Layout
            renderHeader={() => <h1>Title</h1>}
            renderFooter={() => <footer>Footer</footer>}
            renderActions={() => <button>Go</button>}
          />
        );
      `,
    );
    expect(diagnostics).toHaveLength(1);
  });
});
