import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { iframeHasTitle } from "./iframe-has-title.js";

describe("a11y/iframe-has-title regressions", () => {
  it("allows an unnamed preview iframe inside a statically hidden subtree", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => (
        <div className="design-card-thumb" aria-hidden>
          <iframe src="/preview" title="" loading="lazy" sandbox="allow-scripts" tabIndex={-1} />
        </div>
      );`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("allows a visible unnamed iframe with a negative tab index", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => <iframe src="/preview" title="" tabIndex={-1} />;`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when the ancestor hidden state is dynamic", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = ({ isHidden }) => (
        <div aria-hidden={isHidden}>
          <iframe src="/preview" title="" />
        </div>
      );`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows an unnamed iframe with a statically hidden direct state", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => <iframe aria-hidden="true" src="/preview" title="" />;`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when the iframe hidden state is statically false", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => <iframe aria-hidden={false} src="/preview" title="" />;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when the iframe hidden state is dynamic", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = ({ isHidden }) => (
        <iframe aria-hidden={isHidden} src="/preview" title="" />
      );`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps direct hidden state conservative around spreads", () => {
    const provenHidden = runRule(
      iframeHasTitle,
      `const Preview = (props) => <iframe {...props} aria-hidden src="/preview" title="" />;`,
    );
    const possiblyVisible = runRule(
      iframeHasTitle,
      `const Preview = (props) => <iframe aria-hidden {...props} src="/preview" title="" />;`,
    );

    expect(provenHidden.diagnostics).toEqual([]);
    expect(possiblyVisible.diagnostics).toHaveLength(1);
  });

  it.each([
    [`tabIndex="-2"`, "a negative string tab index"],
    [`tabIndex={-3}`, "a negative expression tab index"],
    [`{...props} tabIndex={-1}`, "a negative tab index after a spread"],
  ])("allows an unnamed iframe with %s", (attributes) => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = (props) => <iframe src="/preview" title="" ${attributes} />;`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [`tabIndex={0}`, "a zero tab index"],
    [`tabIndex={1}`, "a positive tab index"],
    [`tabIndex={tabIndex}`, "a dynamic tab index"],
    [`tabIndex={isHidden ? -1 : 0}`, "a conditional tab index"],
    [`tabIndex={-1} {...props}`, "a later spread that can override the negative tab index"],
  ])("still reports an unnamed iframe with %s", (attributes) => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = (props) => <iframe src="/preview" title="" ${attributes} />;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["none", "presentation", "none button", "invalid presentation"])(
    "allows an unnamed iframe with the decorative %s role",
    (role) => {
      const result = runRule(
        iframeHasTitle,
        `const Preview = () => <iframe src="/preview" title="" role="${role}" />;`,
      );

      expect(result.diagnostics).toEqual([]);
    },
  );

  it("still reports when the first valid role token is not decorative", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => <iframe src="/preview" title="" role="button none" />;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a decorative role that follows an unknown spread", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = (props) => (
        <iframe {...props} src="/preview" title="" role="presentation" />
      );`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [`role="application"`, "a non-decorative role"],
    [`role={role}`, "a dynamic role"],
    [`role={isDecorative ? "none" : "application"}`, "a mixed conditional role"],
    [`role="none" {...props}`, "a later spread that can override the decorative role"],
  ])("still reports an unnamed iframe with %s", (attributes) => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = (props) => <iframe src="/preview" title="" ${attributes} />;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not inherit a decorative role from an ancestor", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => <div role="presentation"><iframe src="/preview" title="" /></div>;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a hidden ancestor through fragments and conditional children", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = ({ show }) => (
        <section aria-hidden="true">
          <>{show && <div><iframe src="/preview" /></div>}</>
        </section>
      );`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it.each(["Fragment", "React.Fragment"])(
    "allows a hidden ancestor through the named fragment %s",
    (fragmentName) => {
      const result = runRule(
        iframeHasTitle,
        `const Preview = () => (
          <section aria-hidden="true">
            <${fragmentName}><iframe src="/preview" /></${fragmentName}>
          </section>
        );`,
      );

      expect(result.diagnostics).toEqual([]);
    },
  );

  it("does not treat a locally bound Fragment component as transparent", () => {
    const result = runRule(
      iframeHasTitle,
      `const Fragment = ({ children }) => <PortalTarget>{children}</PortalTarget>;
      const Preview = () => (
        <section aria-hidden="true">
          <Fragment><iframe src="/preview" /></Fragment>
        </section>
      );`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows an iframe supplied through an intrinsic children prop", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => (
        <div aria-hidden="true" children={<iframe src="/preview" title="" />} />
      );`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not inherit hidden state through an opaque component boundary", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => (
        <div aria-hidden="true">
          <PortalTarget><iframe src="/preview" title="" /></PortalTarget>
        </div>
      );`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a configured iframe component inside a hidden host subtree", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => (
        <div aria-hidden="true"><Frame src="/preview" title="" /></div>
      );`,
      { settings: { "jsx-a11y": { components: { Frame: "iframe" } } } },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a configured host-like component as a proven DOM ancestor", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => (
        <HiddenRegion aria-hidden="true"><iframe src="/preview" title="" /></HiddenRegion>
      );`,
      { settings: { "jsx-a11y": { components: { HiddenRegion: "div" } } } },
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not inherit hidden state through a non-children prop", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => (
        <div aria-hidden="true">
          <PortalTarget content={<iframe src="/preview" title="" />} />
        </div>
      );`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not inherit hidden state through a portal call", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => (
        <div aria-hidden="true">
          {createPortal(<iframe src="/preview" title="" />, document.body)}
        </div>
      );`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a visible titled iframe quiet", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => <iframe src="/preview" title="Design preview" />;`,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
