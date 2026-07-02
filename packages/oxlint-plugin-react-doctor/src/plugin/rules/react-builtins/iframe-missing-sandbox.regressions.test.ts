import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { iframeMissingSandbox } from "./iframe-missing-sandbox.js";

describe("react-builtins/iframe-missing-sandbox — regressions", () => {
  // A fully-opaque spread can forward `sandbox` at runtime, so an iframe
  // with only a spread and no explicit `sandbox` must not be flagged.
  it("stays silent on <iframe {...props} /> (sandbox may come via spread)", () => {
    const result = runRule(
      iframeMissingSandbox,
      `const SafeFrame = (props) => <iframe {...props} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // An explicit `src` marks the element as the real embed site: the author
  // chose what to embed here, so a missing `sandbox` is their omission and
  // the spread bailout must not apply.
  it("still flags <iframe {...rest} src=... /> (explicit src alongside a spread)", () => {
    const result = runRule(
      iframeMissingSandbox,
      `const Frame = (rest) => <iframe {...rest} src="https://third-party.example" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still validates an explicit invalid sandbox value alongside a spread", () => {
    const result = runRule(
      iframeMissingSandbox,
      `const Frame = (props) => <iframe {...props} sandbox="not-a-token" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // The `createElement` path must mirror the JSX spread bailout: an opaque
  // props bag or a `{ ...props }` spread can forward `sandbox` at runtime.
  it("stays silent on createElement('iframe', props) with an opaque props bag", () => {
    const result = runRule(
      iframeMissingSandbox,
      `const Frame = (props) => React.createElement("iframe", props);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on createElement('iframe', { ...props }) (sandbox may come via spread)", () => {
    const result = runRule(
      iframeMissingSandbox,
      `const Frame = (props) => React.createElement("iframe", { ...props });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags createElement('iframe', { ...rest, src }) (explicit src alongside a spread)", () => {
    const result = runRule(
      iframeMissingSandbox,
      `const Frame = (rest) => React.createElement("iframe", { ...rest, src: "https://third-party.example" });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on createElement('iframe', getProps()) opaque call result", () => {
    const result = runRule(iframeMissingSandbox, `React.createElement("iframe", getProps());`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags createElement('iframe', null) (no props carry no sandbox)", () => {
    const result = runRule(iframeMissingSandbox, `React.createElement("iframe", null);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags createElement('iframe', void 0)", () => {
    const result = runRule(iframeMissingSandbox, `React.createElement("iframe", void 0);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags createElement('iframe', { title }) with no sandbox and no spread", () => {
    const result = runRule(iframeMissingSandbox, `React.createElement("iframe", { title: "x" });`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Mined ant-design FP (.dumi/theme/builtins/Previewer/CodePreviewer.tsx:147):
  // a docs-site demo iframe. Docs/demo trees are non-production surfaces, so
  // the whole rule skips testlike filenames — including `.dumi` trees, whose
  // inner `/pages/` + `/components/` segments must not hide the marker.
  const antDesignPreviewerFixture = `
    const iframePreview = useMemo(() => {
      if (!iframe) return null;
      return (
        <BrowserFrame>
          <iframe
            src={demoUrlWithTheme}
            height={iframe === true ? undefined : iframe}
            title="demo"
            className="iframe-demo"
          />
        </BrowserFrame>
      );
    }, [demoUrlWithTheme, iframe]);
  `;

  it("stays silent in a .dumi theme file (mined ant-design CodePreviewer shape)", () => {
    const result = runRule(iframeMissingSandbox, antDesignPreviewerFixture, {
      filename: ".dumi/theme/builtins/Previewer/CodePreviewer.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent in a .dumi pages file (source-root segments below .dumi)", () => {
    const result = runRule(iframeMissingSandbox, antDesignPreviewerFixture, {
      filename: "/repo/.dumi/pages/index/index.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags the same sandbox-less iframe in a regular src file", () => {
    const result = runRule(iframeMissingSandbox, antDesignPreviewerFixture, {
      filename: "src/app/page.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags inside a test-fixture project's src tree (below the source root)", () => {
    const result = runRule(iframeMissingSandbox, antDesignPreviewerFixture, {
      filename: "tests/fixtures/proj/src/app/embed.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
