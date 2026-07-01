import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { iframeMissingSandbox } from "./iframe-missing-sandbox.js";

describe("react-builtins/iframe-missing-sandbox — regressions", () => {
  // A spread can forward `sandbox` at runtime, so an iframe with only a
  // spread and no explicit `sandbox` must not be flagged as missing.
  it("stays silent on <iframe {...props} /> (sandbox may come via spread)", () => {
    const result = runRule(
      iframeMissingSandbox,
      `const SafeFrame = (props) => <iframe {...props} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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

  it("still flags createElement('iframe', null) (no props carry no sandbox)", () => {
    const result = runRule(iframeMissingSandbox, `React.createElement("iframe", null);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags createElement('iframe', { title }) with no sandbox and no spread", () => {
    const result = runRule(iframeMissingSandbox, `React.createElement("iframe", { title: "x" });`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
