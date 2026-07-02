import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { windowOpenWithoutNoopener } from "./window-open-without-noopener.js";

describe("window-open-without-noopener", () => {
  it("flags a bare window.open statement with _blank", () => {
    const result = runRule(windowOpenWithoutNoopener, `window.open(url, '_blank');`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags window.open with a discarded return", () => {
    const result = runRule(windowOpenWithoutNoopener, `window.open(url);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags globalThis.window.open", () => {
    const result = runRule(windowOpenWithoutNoopener, `globalThis.window.open(url, '_blank');`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a concise arrow inside an onClick handler", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const x = <button onClick={() => window.open(externalUrl, '_blank')} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a concise arrow used as a forEach callback", () => {
    const result = runRule(windowOpenWithoutNoopener, `list.forEach((link) => window.open(link));`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the handle is bound to a variable", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const win = window.open(url, '_blank'); win?.focus();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the handle is assigned", () => {
    const result = runRule(windowOpenWithoutNoopener, `let w; w = window.open(url);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the handle is returned", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `function openIt() { return window.open(url); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the handle is immediately used", () => {
    const result = runRule(windowOpenWithoutNoopener, `window.open(url).focus();`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a concise arrow stored in a variable", () => {
    const result = runRule(windowOpenWithoutNoopener, `const openPopup = () => window.open(url);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag navigating targets", () => {
    for (const target of ["_self", "_top", "_parent"]) {
      const result = runRule(windowOpenWithoutNoopener, `window.open(url, '${target}');`);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("does not flag when features already contain noopener", () => {
    const result = runRule(windowOpenWithoutNoopener, `window.open(url, '_blank', 'noopener');`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when features contain noreferrer", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open(url, '_blank', 'noopener,noreferrer');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a mailto: protocol-handler URL", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open('mailto:support@appflowy.io', '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a tel: protocol-handler URL", () => {
    const result = runRule(windowOpenWithoutNoopener, `window.open('tel:+15551234567');`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a mailto: URL built from a template literal", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`mailto:${email}?subject=hi`, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a hardcoded literal destination (Star-on-GitHub button idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open('https://github.com/millionco/react-doctor', '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a same-origin relative URL (print/report route idiom)", () => {
    const result = runRule(windowOpenWithoutNoopener, `window.open('/reports/print', '_blank');`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a template with a fixed trusted origin and path-only interpolation", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`https://github.com/${owner}/${repo}`, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a same-origin template URL (app preview route idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`/preview?id=${documentId}`, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a nullish URL argument (about:blank stays opener-controlled)", () => {
    for (const call of [
      "window.open();",
      "window.open(null, '_blank');",
      "window.open(undefined, '_blank');",
      "window.open(void 0, '_blank');",
    ]) {
      const result = runRule(windowOpenWithoutNoopener, call);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("does not flag a const URL bound to null", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const fallbackUrl = null;\nwindow.open(fallbackUrl, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a const identifier bound to a hardcoded literal URL", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const docsUrl = 'https://docs.example.com/guide';\nwindow.open(docsUrl, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a const ternary over an origin-pinned template (release-page dialog idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "const releaseUrl = availableVersion ? `https://github.com/owner/repo/releases/tag/v${availableVersion}` : null;\nconst x = <button onClick={() => window.open(releaseUrl, '_blank')} />;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a const chained through another trusted const binding", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const baseUrl = 'https://github.com/owner/repo';\nconst releaseUrl = baseUrl;\nwindow.open(releaseUrl, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a const ternary with one untrusted branch", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const url = useMirror ? mirrorUrl : 'https://example.com/download';\nwindow.open(url, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a let binding even when its initializer is trusted", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `let url = '/safe/route';\nurl = userInput;\nwindow.open(url, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a const holding an awaited API-returned URL (billing-link idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `async function upgrade() {\n  const link = await BillingService.getSubscriptionLink(workspaceId);\n  window.open(link, '_blank');\n}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a hook-destructured URL behind a logical guard (update-checker idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const { releaseUrl } = useUpdateChecker();\nconst x = <button onClick={() => releaseUrl && window.open(releaseUrl, '_blank')} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a member-expression URL from server data (upload-list download idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const onInternalDownload = (file) => {\n  if (file.url) window.open(file.url);\n};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a template whose interpolation sits in the scheme/host position", () => {
    const result = runRule(windowOpenWithoutNoopener, "window.open(`${baseUrl}/path`, '_blank');");
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a template whose fixed prefix does not terminate the host", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`https://github.com${suffix}`, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a protocol-relative template URL", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`//cdn.example.com/${asset}`, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when features come from a shared constant (popup-helper idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const POPUP_FEATURES = 'noopener,noreferrer';\nwindow.open(url, '_blank', POPUP_FEATURES);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a template features string containing noopener (computed popup size idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(url, '_blank', `noopener,noreferrer,width=${width},height=${height}`);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when features are opaque at lint time (imported constant idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `import { POPUP_FEATURES } from './popup';\nwindow.open(url, '_blank', POPUP_FEATURES);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an explicitly nullish features argument like an omitted one", () => {
    for (const features of ["undefined", "null", "void 0"]) {
      const result = runRule(windowOpenWithoutNoopener, `window.open(url, '_blank', ${features});`);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("does not flag a const ternary URL with a void-0 fallback branch", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "const releaseUrl = version ? 'https://github.com/owner/repo' : void 0;\nwindow.open(releaseUrl, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a noopener=value feature entry", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open(url, '_blank', 'noopener=1,width=500');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a feature entry that merely contains noopener as a substring", () => {
    const result = runRule(windowOpenWithoutNoopener, `window.open(url, '_blank', 'notnoopener');`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag features behind a reassignable let binding (opaque at lint time)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `let features = 'width=500';\nfeatures = POPUP_FEATURES;\nwindow.open(url, '_blank', features);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags when a resolvable features constant lacks noopener", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const POPUP_FEATURES = 'width=500,height=400';\nwindow.open(url, '_blank', POPUP_FEATURES);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a discarded window.open behind a logical guard", () => {
    const result = runRule(windowOpenWithoutNoopener, `isExternal && window.open(url, '_blank');`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a discarded window.open in a ternary onClick", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const x = <a onClick={(e) => e.metaKey ? window.open(href, '_blank') : navigate(href)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a void-discarded window.open", () => {
    const result = runRule(windowOpenWithoutNoopener, `void window.open(url, '_blank');`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a window.open in a non-final comma-sequence position", () => {
    const result = runRule(windowOpenWithoutNoopener, `(window.open(url, '_blank'), undefined);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a comma sequence whose final window.open result is captured", () => {
    const result = runRule(windowOpenWithoutNoopener, `const win = (log(), window.open(url));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a logical guard whose result is captured", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const win = canOpen && window.open(url, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a createElement onClick handler like the JSX equivalent", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `React.createElement('button', { onClick: () => window.open(url, '_blank') });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an arrow under a non-handler object property whose handle may be consumed", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `registerFactory({ createWindow: () => window.open(url, '_blank') });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag other postMessage-style calls", () => {
    const result = runRule(windowOpenWithoutNoopener, `webview.postMessage(data);`);
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
