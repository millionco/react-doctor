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

  // MUI Autocomplete's renderTags/renderOption/renderInput are the library's
  // required customization API; the call site cannot restructure a third-party
  // component's props into compound components.
  it("does not flag render props passed to a component imported from a package", () => {
    const { diagnostics } = runRule(
      noRenderPropChildren,
      `
        import { Autocomplete } from "@mui/material";
        const Field = () => (
          <Autocomplete
            renderTags={getRenderTags}
            renderOption={(props, option) => <li {...props}>{option.label}</li>}
            renderInput={(params) => <TextField {...params} />}
          />
        );
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  // react-custom-scrollbars-2's Scrollbars requires renderThumb*/renderView.
  it("does not flag render props forwarded to an unscoped package component", () => {
    const { diagnostics } = runRule(
      noRenderPropChildren,
      `
        import { Scrollbars } from "react-custom-scrollbars-2";
        const AFScroller = ({ children }) => (
          <Scrollbars
            renderThumbHorizontal={(props) => <div {...props} />}
            renderThumbVertical={(props) => <div {...props} />}
            renderView={(props) => <div {...props}>{children}</div>}
          />
        );
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  // Cloudscape test pages import Table via the `~components` build alias —
  // a webpack-style bare specifier, not a first-party path.
  it("does not flag render props on a component imported via a tilde package alias", () => {
    const { diagnostics } = runRule(
      noRenderPropChildren,
      `
        import { Table } from "~components";
        const Page = () => (
          <Table
            renderLoaderPending={({ item }) => <Button>{item.name}</Button>}
            renderLoaderLoading={() => <StatusIndicator type="loading" />}
            renderLoaderError={({ item }) => <StatusIndicator type="error" />}
          />
        );
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags render-prop proliferation on a first-party aliased import", () => {
    const { diagnostics } = runRule(
      noRenderPropChildren,
      `
        import { Layout } from "@/components/layout";
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

  it("still flags render-prop proliferation on a relative import", () => {
    const { diagnostics } = runRule(
      noRenderPropChildren,
      `
        import { Layout } from "./layout";
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
