import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { windowOpenWithoutNoopener } from "./window-open-without-noopener.js";

describe("window-open-without-noopener", () => {
  it("flags a bare window.open statement with _blank", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open(url, '_blank');`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags window.open with a discarded return", () => {
    const result = runRule(windowOpenWithoutNoopener, `window.open(url);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags globalThis.window.open", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `globalThis.window.open(url, '_blank');`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a concise arrow inside an onClick handler", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const x = <button onClick={() => window.open(externalUrl, '_blank')} />;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a concise arrow used as a forEach callback", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `list.forEach((link) => window.open(link));`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the handle is bound to a variable", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const win = window.open(url, '_blank'); win?.focus();`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the handle is assigned", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `let w; w = window.open(url);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the handle is returned", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `function openIt() { return window.open(url); }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the handle is immediately used", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open(url).focus();`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a concise arrow stored in a variable", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const openPopup = () => window.open(url);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag navigating targets", () => {
    for (const target of ["_self", "_top", "_parent"]) {
      const result = runRule(
        windowOpenWithoutNoopener,
        `window.open(url, '${target}');`
      );
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("does not flag when features already contain noopener", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open(url, '_blank', 'noopener');`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when features contain noreferrer", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open(url, '_blank', 'noopener,noreferrer');`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a mailto: protocol-handler URL", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open('mailto:support@appflowy.io', '_blank');`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a tel: protocol-handler URL", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open('tel:+15551234567');`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a mailto: URL built from a template literal", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`mailto:${email}?subject=hi`, '_blank');"
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an https URL opened in a new tab", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open('https://example.com', '_blank');`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag other postMessage-style calls", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `webview.postMessage(data);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare open() that is not the window global", () => {
    const result = runRule(windowOpenWithoutNoopener, `open(url, '_blank');`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-window object's open method", () => {
    const result = runRule(windowOpenWithoutNoopener, `db.open(url);`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
