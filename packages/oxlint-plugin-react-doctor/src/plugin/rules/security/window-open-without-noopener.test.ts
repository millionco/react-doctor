import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
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
    const result = runRule(
      windowOpenWithoutNoopener,
      `[link].forEach((link) => window.open(link));`,
    );
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

  it("does not flag a mailto: template behind a const binding like the inline form", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "const mailtoUrl = `mailto:${email}?subject=hi`;\nwindow.open(mailtoUrl, '_blank');",
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

  it("does not flag a const && URL whose left operand is statically nullish", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const url = null && dynamicUrl;\nwindow.open(url, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a const && URL with a dynamic right operand", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const url = useMirror && mirrorUrl;\nwindow.open(url, '_blank');`,
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

  it("does not flag a template led by a path-builder helper pinned to an app route (dtale export idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "const fullPath = (path, dataId) => `${path}/${dataId}`;\nwindow.open(`${fullPath('/dtale/data-export', dataId)}?type=${exportType}`, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a pathname replacement that can remain protocol-relative", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const getLocation = () => window.location;
       window.open(getLocation().pathname?.replace('/iframe/', '/main/') ?? '', '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a template led by window.location.origin", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`${window.location.origin}/${path}`, '_blank', 'width=700,height=450');",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a helper fed getLocation().href (forward-URL idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const getLocation = () => window.location;
       const buildForwardURL = (href) => href;
       window.open(buildForwardURL(getLocation().href, dataId), '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an origin read off a non-location receiver (postMessage event)", () => {
    const result = runRule(windowOpenWithoutNoopener, "window.open(event.origin, '_blank');");
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a helper-built URL whose first argument is not a same-origin path", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(buildUrl(externalHost, path), '_blank');",
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

  it("flags adjacent interpolation after a trusted origin", () => {
    for (const code of [
      "window.open(`${window.origin}${suffix}`, '_blank');",
      `const buildDestination = (base, suffix) => \`\${base}\${suffix}\`;
       window.open(buildDestination(window.origin, userControlledSuffix), '_blank');`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(1);
    }
  });

  it("keeps later interpolations safe after a path delimiter", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`${window.origin}/preview/${assetId}`, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves stable const concatenation prefixes", () => {
    for (const code of [
      `const destinationPrefix = "https://example.com/";
       window.open(destinationPrefix + slug, "_blank");`,
      `const destinationPrefix = "/safe/";
       window.open(destinationPrefix + slug, "_blank");`,
      `const rootPrefix = "https://example.com/" as const;
       const destinationPrefix = rootPrefix;
       window.open(destinationPrefix + slug, "_blank");`,
      `const rootPrefix = "https://example.com/" satisfies string;
       const destinationPrefix = rootPrefix;
       window.open(destinationPrefix + slug, "_blank");`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("does not trust opaque or origin-incomplete concatenation prefixes", () => {
    for (const code of [
      `import { destinationPrefix } from "./config";
       window.open(destinationPrefix + slug, "_blank");`,
      `let destinationPrefix = "/safe/";
       window.open(destinationPrefix + slug, "_blank");`,
      `const destinationPrefix = "https://example.com";
       window.open(destinationPrefix + slug, "_blank");`,
      `const destinationPrefix = userControlledPrefix;
       window.open(destinationPrefix + slug, "_blank");`,
      `const destinationPrefix = "//";
       window.open(destinationPrefix + slug, "_blank");`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(1);
    }
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

  it("does not flag templates with opaque feature interpolations", () => {
    for (const features of [
      `\`\${POPUP_FEATURES}\``,
      `\`width=500,\${POPUP_FEATURES}\``,
      `\`\${POPUP_FEATURES},height=400\``,
      `\`width=500 \${POPUP_FEATURES}\``,
      `\`noopener=false,\${POPUP_FEATURES}\``,
      `\`\${dynamicName}=true\``,
      `\`noopener=\${dynamicValue}\``,
      `\`noreferrer=\${dynamicValue}\``,
      `\`\${dynamicPrefix}\${dynamicName}\``,
      `\`noopener=\${dynamicPrefix}\${dynamicValue}\``,
    ]) {
      const result = runRule(
        windowOpenWithoutNoopener,
        `import { POPUP_FEATURES } from './popup';
         window.open(url, '_blank', ${features});`,
      );
      expect(result.diagnostics, features).toHaveLength(0);
    }
  });

  it("still resolves a wholly interpolated local features constant", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const POPUP_FEATURES = 'width=500,height=400';
       window.open(url, '_blank', \`\${POPUP_FEATURES}\`);`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("flags a bare awaited window.open in an async handler", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `async function openIt() { await window.open(url, '_blank'); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an awaited window.open whose handle is captured", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `async function openIt() { const win = await window.open(url, '_blank'); win?.focus(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("flags a createElement handler under a string-literal onClick key", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `React.createElement('button', { 'onClick': () => window.open(url, '_blank') });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an || URL whose left operand is a truthy trusted literal", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open('https://example.com/download' || dynamicUrl, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a const || URL with a truthy trusted literal left and dynamic fallback", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const url = 'https://example.com/download' || mirrorUrl;\nwindow.open(url, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an || URL whose falsy empty-string left falls through to a dynamic operand", () => {
    const result = runRule(windowOpenWithoutNoopener, `window.open('' || dynamicUrl, '_blank');`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an || URL whose trusted left is behind a reassignable let binding", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `let primaryUrl = 'https://example.com/download';\nprimaryUrl = userInput;\nwindow.open(primaryUrl || fallbackUrl, '_blank');`,
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

  it("flags a bare global open() call", () => {
    const result = runRule(windowOpenWithoutNoopener, `open(url, '_blank');`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a non-window object's open method", () => {
    const result = runRule(windowOpenWithoutNoopener, `db.open(url);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Hardcoded link map: member access on a same-file const object of literal URLs", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const EXTERNAL_LINKS = {
  docs: 'https://docs.example.com/',
  github: 'https://github.com/acme/widget',
};
const HelpMenu = () => (
  <button onClick={() => window.open(EXTERNAL_LINKS.docs, '_blank')}>Docs</button>
);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Nav config array with hardcoded hrefs: item.external ? window.open(item.href) : navigate(item.href)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const NAV_ITEMS = [
  { label: 'Docs', href: 'https://docs.example.com/', external: true },
  { label: 'Settings', href: '/settings', external: false },
];
const Sidebar = ({ navigate }) => (
  <ul>
    {NAV_ITEMS.map((item) => (
      <li key={item.label}>
        <button
          onClick={() => {
            item.external ? window.open(item.href, '_blank') : navigate(item.href);
          }}
        >
          {item.label}
        </button>
      </li>
    ))}
  </ul>
);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: String concatenation with a pinned https origin — the exempt template's exact + equivalent", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open('https://github.com/' + owner + '/' + repo, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: String concatenation with a same-origin path prefix (drawdb wild shape)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open('/editor/templates/' + selectedTemplateId, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Same-origin absolute URL via ${window.location.origin} in the host position", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open(\`\${window.location.origin}/preview?id=\${documentId}\`, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: URL API builder: new URL literal origin + searchParams.set + toString()", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const shareUrl = new URL('https://twitter.com/intent/tweet');
shareUrl.searchParams.set('text', message);
window.open(shareUrl.toString(), '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an unresolved imported URL constant", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `import { CHANGELOG_URL } from './constants';
const openChangelog = () => {
  window.open(CHANGELOG_URL, '_blank');
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Template interpolating a same-file trusted const base URL", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const API_BASE = 'https://api.example.com';
window.open(\`\${API_BASE}/docs/getting-started\`, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: OAuth popup that must keep window.opener for the postMessage handshake", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const API_BASE = 'https://api.example.com';
function ConnectButton({ onToken }) {
  const startOAuth = () => {
    window.open(\`\${API_BASE}/oauth/google/start\`, 'oauth-popup', 'width=500,height=650');
  };
  React.useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'oauth-token') onToken(event.data.token);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onToken]);
  return <button onClick={startOAuth}>Connect Google</button>;
}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Blob object URL of app-generated content (SVG/PDF export preview)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const handleExport = () => {
  const svgMarkup = new XMLSerializer().serializeToString(svgRef.current);
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml' });
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, '_blank');
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: as-const literal URL binding (TSAsExpression not unwrapped)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const DOCS_URL = 'https://docs.example.com/guide' as const;
window.open(DOCS_URL, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: let assigned only hardcoded literals across switch branches", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `function openHelp(kind) {
  let url;
  switch (kind) {
    case 'docs':
      url = 'https://docs.example.com/';
      break;
    default:
      url = 'https://support.example.com/';
  }
  window.open(url, '_blank');
}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Const search base + encodeURIComponent query (freeCodeCamp shape)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const SEARCH_URL = 'https://www.freecodecamp.org/news/search/';
window.open(\`\${SEARCH_URL}?query=\${encodeURIComponent(value)}\`, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Template led by window.origin (AppFlowy as-template idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`${window.origin}/as-template?viewUrl=${encodeURIComponent(publishUrl)}`, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves global destination proofs after the production host captures Program", () => {
    const parsed = parseFixture(
      `const blobUrl = URL.createObjectURL(blob);
window.open(blobUrl);
window.open(\`\${window.origin}/preview\`);`,
    );
    attachParentReferences(parsed.program);
    const diagnostics: unknown[] = [];
    const visitors = wrapWithSemanticContext(windowOpenWithoutNoopener).create({
      report: (diagnostic) => diagnostics.push(diagnostic),
    });
    walkAst(parsed.program, (node) => visitors[node.type]?.(node));
    expect(diagnostics).toHaveLength(0);
  });

  it("flags an unresolved imported camelCase URL constant", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `import { downloadPage } from '@/utils/url';
window.open(downloadPage);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unresolved path-builder called with a dynamic path", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const openTab = (path) => {
  const url = fullPath(path, dataId);
  window.open(url, '_blank', 'titlebar=1,location=1,status=1,width=500,height=400');
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags unresolved nested URL builders", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const exportHTML = () => {
  const url = buildURL(fullPath(DATA_ENDPOINT, dataId), { export: true });
  window.open(url, '_blank');
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Sync get…Url route-builder helper (AppFlowy open-in-new-tab idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const getViewUrl = (view, currentWorkspaceId) =>
  "/workspace/" + currentWorkspaceId + "/view/" + view.view_id;
const onSelect = () => {
  const url = getViewUrl(view, currentWorkspaceId);
  if (!url) return;
  window.open(url, '_blank');
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an unresolved get…Url helper", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `function viewAllDep({ ctrlKey, metaKey }) {
  window.open(getUrl({ density, operation }), ctrlKey || metaKey ? '_blank' : '_self');
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Bare relative template path (glific chat route idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`chat/${contact.id}?search=${item.messageNumber}`);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: file: URL template of an app-written log file (Tauri debug idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`file://${rustStore.debugLogPath}`, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Prop of a local non-exported component whose every usage is a literal path (rad-ui card idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const IntegrationCard = ({ title, cta = "", ctaLink }) => {
  const onClickHandler = () => {
    window.open(ctaLink, '_blank');
  };
  return <button onClick={onClickHandler}>{cta}</button>;
};
const Page = () => (
  <div>
    <IntegrationCard ctaLink="/docs/first-steps/installation" cta="Install" title="Install" />
    <IntegrationCard ctaLink="/docs/first-steps/introduction" cta="View Docs" title="Docs" />
  </div>
);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a prop of an exported component (unknowable call sites)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `export const PopoverPanel = ({ url }) => (
  <div onClick={() => window.open(url, '_blank')} />
);
const Demo = () => <PopoverPanel url="/docs" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a local component prop when one usage passes a dynamic value", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const Card = ({ ctaLink }) => (
  <button onClick={() => window.open(ctaLink, '_blank')}>Go</button>
);
const Page = ({ items }) => (
  <div>
    <Card ctaLink="/docs" />
    <Card ctaLink={items[0].url} />
  </div>
);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a build…Url helper result (composable-origin builder stays opaque)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(buildCorrelationsUrl(dataId, encodeStrings), '_blank');",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a process…Url transformer of user-entered links (AppFlowy openUrl idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const newUrl = processUrl(url);
window.open(newUrl, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a config-supplied help link behind a truthiness guard (jaeger trace-diff idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const onClick = () => {
  const helpLink = getConfig().traceDiff?.helpLink;
  if (helpLink) {
    window.open(helpLink, '_blank');
  }
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an untrusted dynamic destination", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const OpenLink = ({ url }) => (
         <button onClick={() => window.open(url, "_blank")}>Open</button>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a let reassigned from a prop across branches", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `function openTarget(kind, external) {
         let url;
         switch (kind) {
           case "docs":
             url = "https://docs.example.com/";
             break;
           default:
             url = external;
         }
         window.open(url, "_blank");
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a const object map whose accessed value is dynamic", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const LINKS = { docs: buildUrl() };
       const Help = () => (
         <button onClick={() => window.open(LINKS.docs, "_blank")}>Docs</button>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags useState setters fed by unresolved member builders", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const buildUrls = (dataId, chartType) => {
  const imageUrl = buildURLString(menuFuncs.fullPath(\`/dtale/missingno/\${chartType}\`, dataId), { id: '1' });
  const fileUrl = buildURLString(menuFuncs.fullPath(\`/dtale/missingno/\${chartType}\`, dataId), { file: 'true' });
  return [imageUrl, fileUrl];
};
const MissingNoCharts = ({ dataId, chartType }) => {
  const [imageUrl, setImageUrl] = React.useState();
  const [fileUrl, setFileUrl] = React.useState();
  React.useEffect(() => {
    const urls = buildUrls(dataId, chartType);
    setImageUrl(urls[0]);
    setFileUrl(urls[1]);
  }, [dataId, chartType]);
  return (
    <>
      <button onClick={() => window.open(imageUrl ?? '', '_blank')} />
      <button onClick={() => window.open(fileUrl ?? '', '_blank')} />
    </>
  );
};`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("still flags a useState URL whose setter receives server data", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const Portal = () => {
  const [portalUrl, setPortalUrl] = React.useState();
  React.useEffect(() => {
    api.fetchPortal().then((response) => setPortalUrl(response.url));
  }, []);
  return <button onClick={() => window.open(portalUrl ?? '', '_blank')} />;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an anchor helper wired through a custom Link with an unresolved href helper", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `export function FixtureLink({ children, fixtureId }) {
  return (
    <Link
      href={createRelativePlaygroundUrl({ fixture: fixtureId })}
      onClick={e => {
        e.preventDefault();
        if (e.metaKey) openAnchorInNewTab(e.currentTarget);
        else selectFixture(fixtureId);
      }}
    >
      {children}
    </Link>
  );
}
function openAnchorInNewTab(anchorEl) {
  window.open(anchorEl.href, '_blank');
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an anchor helper wired through a custom FixtureLink component", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `export function FixtureBookmarks({ bookmarks, onFixtureSelect }) {
  return (
    <ul>
      {bookmarks.map(fixtureItem => {
        const { fixtureId } = fixtureItem;
        function handleClick(e) {
          e.preventDefault();
          if (e.metaKey) {
            openAnchorInNewTab(e.currentTarget);
          } else {
            onFixtureSelect(fixtureId);
          }
        }
        return (
          <li key={fixtureId}>
            <FixtureLink href={createRelativePlaygroundUrl({ fixture: fixtureId })} onClick={handleClick}>
              {fixtureId}
            </FixtureLink>
          </li>
        );
      })}
    </ul>
  );
}
function openAnchorInNewTab(anchorEl) {
  window.open(anchorEl.href, '_blank');
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: anchorEl.href helper fed currentTarget from an intrinsic anchor with a proven href", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const createRelativePlaygroundUrl = ({ fixture }) => "/playground/" + fixture;
       const openAnchorInNewTab = (anchorEl) => {
         window.open(anchorEl.href, "_blank");
       };
       const FixtureLink = ({ fixtureId }) => (
         <a
           href={createRelativePlaygroundUrl({ fixture: fixtureId })}
           onClick={(event) => {
             event.preventDefault();
             if (event.metaKey) openAnchorInNewTab(event.currentTarget);
           }}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an anchorEl.href helper when the wired element's href is dynamic", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const ArticleLink = ({ article }) => (
  <a
    href={article.url}
    onClick={e => {
      if (e.metaKey) openAnchorInNewTab(e.currentTarget);
    }}
  >
    {article.title}
  </a>
);
function openAnchorInNewTab(anchorEl) {
  window.open(anchorEl.href, '_blank');
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: local useCallback wrapper only ever called with hardcoded literals (rad-ui NavBar idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const NavBar = () => {
  const openLink = useCallback(
    (url) => () => {
      window.open(url, "_blank");
    },
    []
  );
  return (
    <div>
      <button onClick={openLink("https://discord.gg/nMaQfeEPNp")}>Discord</button>
      <button onClick={openLink("https://github.com/rad-ui/ui")}>GitHub</button>
    </div>
  );
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a local wrapper when any call site passes a dynamic value", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const Menu = ({ item }) => {
  const openLink = (url) => {
    window.open(url, "_blank");
  };
  return (
    <div>
      <button onClick={() => openLink("https://github.com/rad-ui/ui")}>GitHub</button>
      <button onClick={() => openLink(item.url)}>Item</button>
    </div>
  );
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an exported helper whose URL parameter has unknowable callers (ant-design openUrl idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `export const openUrl = ({ href, target }) => {
  switch (target) {
    case '_blank':
      window.open(href, target);
      break;
    default:
      window.location.href = href;
  }
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: destructured href from a map over an inline array of hardcoded links (pwa-kit social-icons idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const SocialIcons = () => (
  <div>
    {[
      { href: 'https://www.youtube.com/channel/UCSTGHqzR1Q9yAVbiS3dAFHg', ariaLabel: 'YouTube' },
      { href: '/', ariaLabel: 'Pinterest' },
      { href: 'https://twitter.com/CommerceCloud', ariaLabel: 'Twitter' },
    ].map(({ href, ariaLabel }) => (
      <button
        key={href}
        onClick={() => {
          window.open(href);
        }}
        aria-label={ariaLabel}
      />
    ))}
  </div>
);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a destructured value from a map over dynamic template data (glific template-buttons idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `export const TemplateButtons = ({ template }) => {
  const handleButtonClick = (type, value) => {
    if (type === 'call-to-action') {
      if (value) window.open(value, '_blank');
    }
  };
  return (
    <div>
      {template?.map(({ title, value, type }) => (
        <button key={title} onClick={() => handleButtonClick(type, value)}>
          {title}
        </button>
      ))}
    </div>
  );
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: binding co-navigated through Router.push in a sibling branch (hyperdx cmd+click-row idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `import Router from "next/router";
export function ListingRow({ href, name }) {
  return (
    <tr
      onClick={e => {
        if (e.metaKey || e.ctrlKey) {
          window.open(href, '_blank');
        } else {
          Router.push(href);
        }
      }}
      onAuxClick={e => {
        if (e.button === 1) {
          window.open(href, '_blank');
        }
      }}
    >
      {name}
    </tr>
  );
}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a host-pinned protocol//hostname template with a config port (PortOS launch idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      "window.open(`${window.location.protocol}//${window.location.hostname}:${app.uiPort}`, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a URL destructured from a plural get…Urls getter (PortOS launch-URLs idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const { https, http } = getLaunchUrls(app);
window.open(https, '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a URL destructured from an awaited API .then callback (PortOS OAuth idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `api.getGoogleAuthUrl().then(({ url }) => {
  window.open(url, '_blank');
});`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});

// Cross-file verification needs actual files on disk so the rule's
// resolveCrossFileExport plumbing can resolve and parse the imported
// modules. Each test writes a temp project and lints the consumer file
// under its absolute path.
describe("window-open-without-noopener — cross-file imported destinations", () => {
  let temporaryDirectory = "";

  beforeEach(() => {
    temporaryDirectory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "rd-window-open-xfile-")),
    );
    __clearParseSourceFileCacheForTests();
    writeFile("package.json", JSON.stringify({ name: "fixture", type: "module" }));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeFile = (relativePath: string, contents: string): string => {
    const absolutePath = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents, "utf8");
    return absolutePath;
  };

  const runRuleAt = (relativePath: string, code: string) =>
    runRule(windowOpenWithoutNoopener, code, { filename: writeFile(relativePath, code) });

  it("stays quiet: imported const verified cross-file as a relative path literal", () => {
    writeFile("src/config.ts", "export const downloadTarget = '/downloads/latest';\n");
    const result = runRuleAt(
      "src/App.tsx",
      "import { downloadTarget } from './config';\nwindow.open(downloadTarget, '_blank');\n",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a URL-named imported const verified cross-file as an external https literal (name-heuristic override)", () => {
    writeFile(
      "src/config.ts",
      "export const downloadPage = 'https://downloads.example.com/latest';\n",
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { downloadPage } from './config';\nwindow.open(downloadPage, '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a foreign initializer whose new URL() base is an external origin", () => {
    writeFile(
      "src/config.ts",
      "const externalBase = 'https://evil.example.com';\nexport const storeUrl = new URL('/store', externalBase).toString();\n",
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { storeUrl } from './config';\nwindow.open(storeUrl, '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: foreign initializer building new URL() against the page's own origin", () => {
    writeFile(
      "src/config.ts",
      "export const storeUrl = new URL('/store', window.location.origin).toString();\n",
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { storeUrl } from './config';\nwindow.open(storeUrl, '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: parenthesized foreign URL serialization remains transparent", () => {
    writeFile(
      "src/config.ts",
      "export const storeUrl = (new URL('/store', window.location.origin)).toString();\n",
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { storeUrl } from './config';\nwindow.open(storeUrl, '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("fails closed for a foreign raw URL object coerced in the consumer", () => {
    writeFile(
      "src/config.ts",
      "export const storeUrl = new URL('/store', window.location.origin);\n",
    );
    const result = runRuleAt(
      "src/App.tsx",
      `import { storeUrl } from './config';
URL.prototype.toString = () => userControlledUrl;
window.open(storeUrl, '_blank');
`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves a foreign URL template snapshot made before consumer mutations", () => {
    writeFile(
      "src/config.ts",
      "export const storeUrl = `${new URL('/store', window.location.origin)}`;\n",
    );
    const result = runRuleAt(
      "src/App.tsx",
      `import { storeUrl } from './config';
URL.prototype.toString = () => userControlledUrl;
window.open(storeUrl, '_blank');
`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not reuse a local opener invocation while analyzing imported URL values", () => {
    writeFile(
      "src/config.ts",
      "export const storeUrl = new URL('/store', window.location.origin);\n",
    );
    const unsafeResult = runRuleAt(
      "src/App.tsx",
      `import { storeUrl } from './config';
const openFirst = () => window.open('/safe');
openFirst();
URL.prototype.toString = () => userControlledUrl;
const openStore = () => window.open(storeUrl);
openStore();
`,
    );
    expect(unsafeResult.diagnostics).toHaveLength(1);

    writeFile(
      "src/config.ts",
      "export const storeUrl = `${new URL('/store', window.location.origin)}`;\n",
    );
    const safeResult = runRuleAt(
      "src/Other.tsx",
      `import { storeUrl } from './config';
URL.prototype.toString = () => userControlledUrl;
const openFirst = () => window.open('/safe');
openFirst();
const openStore = () => window.open(storeUrl);
openStore();
`,
    );
    expect(safeResult.diagnostics).toHaveLength(0);
  });

  it("still flags when a barrel hides a re-export behind a same-named local decoy helper", () => {
    writeFile(
      "src/impl.ts",
      "export const buildShareUrl = () => 'https://evil.example.com/share';\n",
    );
    writeFile(
      "src/barrel.ts",
      "const buildShareUrl = () => '/local-decoy';\nvoid buildShareUrl;\nexport { buildShareUrl } from './impl';\n",
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { buildShareUrl } from './barrel';\nwindow.open(buildShareUrl(), '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects an imported builder that delegates to an unresolved buildURLString helper", () => {
    writeFile(
      "src/correlations-repository.ts",
      `import { buildURLString } from './url-utils';
export const buildCorrelationsUrl = (dataId: string, encodeStrings: boolean, pps = false, image = false): string =>
  buildURLString(\`/dtale/correlations/\${dataId}\`, {
    encodeStrings: \`\${encodeStrings}\`,
    pps: \`\${pps}\`,
    image: \`\${image}\`,
  });
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      `import { buildCorrelationsUrl } from './correlations-repository';
window.open(buildCorrelationsUrl(dataId, encodeStrings, isPPS, true), '_blank');
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an imported build…Url helper with one opaque return", () => {
    writeFile(
      "src/share-url.ts",
      `export const buildShareUrl = (target: string | undefined) => {
  if (target) {
    return target;
  }
  return '/share';
};
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { buildShareUrl } from './share-url';\nwindow.open(buildShareUrl(candidate), '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects writes inside a foreign helper using foreign source offsets", () => {
    writeFile(
      "src/share-url.ts",
      `export const buildShareUrl = (userControlledUrl: string) => {
  const buildPath = (path: string) => {
    path = userControlledUrl;
    return path;
  };
  return buildPath('/safe');
};
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { buildShareUrl } from './share-url';\nwindow.open(buildShareUrl(userControlledUrl), '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a foreign initializer snapshots a trusted let before a later write", () => {
    writeFile(
      "src/share-url.ts",
      `let popupPath = '/safe';
export const popupTarget = popupPath;
popupPath = userControlledUrl;
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { popupTarget } from './share-url';\nwindow.open(popupTarget, '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a foreign initializer has an uncalled nested mutator", () => {
    writeFile(
      "src/share-url.ts",
      `let popupPath = '/safe';
const mutatePopupPath = () => {
  popupPath = userControlledUrl;
};
void mutatePopupPath;
export const popupTarget = popupPath;
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { popupTarget } from './share-url';\nwindow.open(popupTarget, '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a module write that completes before an imported helper is called", () => {
    writeFile(
      "src/share-url.ts",
      `let popupPath = '/safe';
export const buildShareUrl = () => popupPath;
popupPath = userControlledUrl;
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { buildShareUrl } from './share-url';\nwindow.open(buildShareUrl(), '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when an imported helper has an uncalled nested mutator", () => {
    writeFile(
      "src/share-url.ts",
      `let popupPath = '/safe';
const mutatePopupPath = () => {
  popupPath = userControlledUrl;
};
void mutatePopupPath;
export const buildShareUrl = () => popupPath;
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { buildShareUrl } from './share-url';\nwindow.open(buildShareUrl(), '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a foreign helper mutated by a function called during module initialization", () => {
    writeFile(
      "src/share-url.ts",
      `let popupPath = '/safe';
mutatePopupPath();
export const buildShareUrl = () => popupPath;
function mutatePopupPath() {
  popupPath = userControlledUrl;
}
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { buildShareUrl } from './share-url';\nwindow.open(buildShareUrl(), '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a write after a foreign helper return is unreachable", () => {
    writeFile(
      "src/share-url.ts",
      `export const buildShareUrl = () => {
  let popupPath = '/safe';
  return popupPath;
  popupPath = userControlledUrl;
};
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { buildShareUrl } from './share-url';\nwindow.open(buildShareUrl(), '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a write before a foreign helper return", () => {
    writeFile(
      "src/share-url.ts",
      `export const buildShareUrl = () => {
  let popupPath = '/safe';
  popupPath = userControlledUrl;
  return popupPath;
};
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { buildShareUrl } from './share-url';\nwindow.open(buildShareUrl(), '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a foreign URL initializer precedes a global replacement", () => {
    writeFile(
      "src/share-url.ts",
      `export const storeUrl = new URL('/store', location.origin).toString();
URL = EvilURL;
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { storeUrl } from './share-url';\nwindow.open(storeUrl, '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a global replacement that completes before an imported URL helper is called", () => {
    writeFile(
      "src/share-url.ts",
      `export const buildShareUrl = () => new URL('/store', location.origin).toString();
URL = EvilURL;
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { buildShareUrl } from './share-url';\nwindow.open(buildShareUrl(), '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a global replacement called during module initialization", () => {
    writeFile(
      "src/share-url.ts",
      `const replaceUrl = () => {
  URL = EvilURL;
};
replaceUrl();
export const buildShareUrl = () => new URL('/store', location.origin).toString();
`,
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { buildShareUrl } from './share-url';\nwindow.open(buildShareUrl(), '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when the imported helper delegates to another imported helper (no transitive cross-file hops)", () => {
    writeFile("src/deep.ts", "export const buildDeepUrl = () => '/deep';\n");
    writeFile(
      "src/urls.ts",
      "import { buildDeepUrl } from './deep';\nexport const buildOuterUrl = () => buildDeepUrl();\n",
    );
    const result = runRuleAt(
      "src/App.tsx",
      "import { buildOuterUrl } from './urls';\nwindow.open(buildOuterUrl(), '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unresolvable import with a URL-suffixed name", () => {
    const result = runRuleAt(
      "src/App.tsx",
      "import { downloadPage } from './missing-config';\nwindow.open(downloadPage, '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("fails closed when the host provides no filename", () => {
    writeFile(
      "src/config.ts",
      "export const downloadPage = 'https://downloads.example.com/latest';\n",
    );
    const result = runRule(
      windowOpenWithoutNoopener,
      "import { downloadPage } from './config';\nwindow.open(downloadPage, '_blank');\n",
      { filename: undefined },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: renamed import resolved through a barrel re-export hop to a same-origin path", () => {
    writeFile("src/paths.ts", "export const internalDownloadPath = '/downloads/latest';\n");
    writeFile("src/index.ts", "export { internalDownloadPath as downloadPage } from './paths';\n");
    const result = runRuleAt(
      "src/App.tsx",
      "import { downloadPage as appDownloadTarget } from './index';\nwindow.open(appDownloadTarget, '_blank');\n",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("caps cross-file resolutions per linted file and fails closed past the cap", () => {
    writeFile(
      "src/config.ts",
      [
        "export const alphaPage = 'https://external.example.com/alpha';",
        "export const betaPage = 'https://external.example.com/beta';",
        "export const gammaPage = 'https://external.example.com/gamma';",
        "export const deltaPage = 'https://external.example.com/delta';",
      ].join("\n"),
    );
    const result = runRuleAt(
      "src/App.tsx",
      `import { alphaPage, betaPage, gammaPage, deltaPage } from './config';
window.open(alphaPage, '_blank');
window.open(betaPage, '_blank');
window.open(gammaPage, '_blank');
window.open(deltaPage, '_blank');
`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("ignores shadowed window and globalThis bindings", () => {
    for (const code of [
      `const window = { open() {} }; window.open(url);`,
      `const globalThis = { window: { open() {} } }; globalThis.window.open(url);`,
      `const globalThis = { open() {} }; globalThis.open(url);`,
      `const self = { open() {} }; self.open(url);`,
      `const top = { open() {} }; top.open(url);`,
      `const parent = { open() {} }; parent.open(url);`,
      `const frames = { open() {} }; frames.open(url);`,
      `function render(window) { window.open(url); }`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("flags statically computed and transparently wrapped global calls", () => {
    for (const code of [
      `window["open"](url);`,
      "window[`open`](url);",
      `globalThis.open(url);`,
      `self.open(url);`,
      `top.open(url);`,
      `parent.open(url);`,
      `frames.open(url);`,
      `window.top.open(url);`,
      `window.parent.open(url);`,
      `window.frames.open(url);`,
      `globalThis["open"](url);`,
      `(window.open as typeof window.open)(url);`,
      `(window.open(url) as Window | null);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("flags aliases of the global open method", () => {
    for (const code of [
      `const openPopup = globalThis.open; openPopup(url);`,
      `const { open: openPopup } = window; openPopup(url);`,
      `const popupHost = top; popupHost.open(url);`,
      `const openPopup = parent.open; openPopup(url);`,
      `const { open: openPopup } = frames; openPopup(url);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("does not use an unreachable router call as same-origin proof", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `import Router from "next/router";
       const openDestination = (destination) => {
         if (false) Router.push(destination);
         window.open(destination);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a local Router-shaped object as same-origin proof", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const Router = { push() {} };
       const openDestination = (destination) => {
         Router.push(destination);
         window.open(destination);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags explicitly disabled opener protections", () => {
    for (const features of ["noopener=false", "noopener=0", "noopener=no", "noreferrer=false"]) {
      const result = runRule(
        windowOpenWithoutNoopener,
        `window.open(url, "_blank", "${features}");`,
      );
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("accepts explicitly enabled opener protections", () => {
    for (const features of ["noopener", "noopener=true", "noopener=1", "noopener=yes"]) {
      const result = runRule(
        windowOpenWithoutNoopener,
        `window.open(url, "_blank", "${features}");`,
      );
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("does not trust arbitrary pathname-shaped member reads", () => {
    for (const code of [
      `window.open(event.pathname);`,
      `window.open(payload.location.pathname);`,
      `window.open(userLocation.href);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("does not trust an unknown helper merely because its first argument is safe", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open(selectDestination("/safe", userControlledUrl));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("inspects local URL getter returns instead of trusting their names", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const getExternalUrl = () => userControlledUrl; window.open(getExternalUrl());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust arbitrary methods called on a trusted path", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const route = "/safe"; window.open(route.resolveRedirect(userControlledUrl));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a shadowed URL.createObjectURL call as a trusted blob URL", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const URL = { createObjectURL: () => userControlledUrl }; window.open(URL.createObjectURL());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a dynamic replacement change a trusted path into an opaque URL", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open(window.location.pathname.replace("/safe", userControlledUrl));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let shadowed wrapper calls poison a locally proven wrapper", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const openLink = (url) => window.open(url);
       openLink("/safe");
       function unrelated(openLink) { openLink(userControlledUrl); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not use a shadowed router argument as proof for an untrusted destination", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const openLink = (url) => {
         function navigateAnother(url) { router.push(url); }
         void navigateAnother;
         window.open(url);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a shadowed assignment invalidate a trusted local URL", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `let url;
       url = "/safe";
       function assignOther(url) { url = userControlledUrl; }
       window.open(url);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects origin templates whose interpolation can extend or replace the host", () => {
    for (const code of [
      "window.open(`${window.origin}.evil.com`);",
      "window.open(`${window.origin}//evil.com`);",
      'const prefix = ""; window.open(`${prefix}//evil.com`);',
      "window.open(`/\\\\${host}`);",
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("rejects mutable blob and URL proofs", () => {
    for (const code of [
      `URL.createObjectURL = () => userControlledUrl;
       window.open(URL.createObjectURL(blob));`,
      `const popupUrl = new URL("/safe", window.origin);
       popupUrl.href = userControlledUrl;
       window.open(popupUrl.toString());`,
      `const URL = class { toString() { return userControlledUrl; } };
       const popupUrl = new URL("/safe");
       window.open(popupUrl.toString());`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("uses only authoritative intrinsic anchor href attributes", () => {
    for (const code of [
      `const C = ({ dynamicHref }) => <a href="/safe" {...props} onClick={(event) => {
         window.open(event.currentTarget.href);
       }} />;`,
      `const C = ({ dynamicHref }) => <a href="/safe" href={dynamicHref} onClick={(event) => {
         window.open(event.currentTarget.href);
       }} />;`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
    const customElement = runRule(
      windowOpenWithoutNoopener,
      `const C = () => <Link href="/safe" onClick={(event) => {
         window.open(event.currentTarget.href);
       }} />;`,
    );
    expect(customElement.diagnostics).toHaveLength(1);
    const authoritativeHref = runRule(
      windowOpenWithoutNoopener,
      `const openAnchor = (anchor) => {
         window.open(anchor.href);
       };
       const C = () => <a {...props} href="/safe" onClick={(event) => {
         openAnchor(event.currentTarget);
       }} />;`,
    );
    expect(authoritativeHref.diagnostics).toHaveLength(0);
  });

  it("uses the authoritative object property and rejects later mutation", () => {
    for (const code of [
      `const links = { docs: "/safe", docs: userControlledUrl };
       window.open(links.docs);`,
      `const links = { docs: "/safe" };
       links.docs = userControlledUrl;
       window.open(links.docs);`,
      `const links = { docs: "/safe", ...dynamicLinks };
       window.open(links.docs);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("rejects compound writes to a let destination", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `let popupUrl = "/safe";
       popupUrl += userControlledUrl;
       window.open(popupUrl);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a shadowed getLocation helper", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const getLocation = () => ({ href: userControlledUrl });
       window.open(getLocation().href);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects origin-changing pathname transforms", () => {
    for (const code of [
      `window.open(window.location.pathname.slice(1));`,
      `window.open(window.location.pathname.substring(1));`,
      `window.open(window.location.pathname.substr(1));`,
      `window.open(window.location.pathname.replace("/safe", "https://evil.com"));`,
      `window.open(window.location.pathname.replace("safe", "/"));`,
      `window.open(window.location.pathname.replace("/iframe/", "/main/"));`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("does not treat a reduce callback accumulator as an iterated config item", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const links = [{ href: "/safe" }];
       links.reduce((item) => {
         window.open(item.href);
         return item;
       }, { href: userControlledUrl });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires a Router witness in the opposite controlling branch", () => {
    for (const code of [
      `import Router from "next/router";
       const openDestination = (destination, shouldNavigate) => {
         if (shouldNavigate) Router.push(destination);
         window.open(destination);
       };`,
      `import Router from "next/router";
       const openDestination = (destination) => {
         const neverCalled = () => Router.push(destination);
         void neverCalled;
         window.open(destination);
       };`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("accepts exact Next Router aliases in opposite branches", () => {
    for (const code of [
      `import NextRouter from "next/router";
       const openDestination = (destination, newTab) => {
         if (newTab) window.open(destination);
         else NextRouter.push(destination);
       };`,
      `import { useRouter as useNextRouter } from "next/navigation";
       const C = ({ destination, newTab }) => {
         const navigation = useNextRouter();
         if (newTab) window.open(destination);
         else navigation.push(destination);
       };`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("reports only callback returns whose consumers discard the handle", () => {
    for (const code of [
      `const handles = items.map(() => window.open(url));`,
      `const popupPromise = promise.then(() => window.open(url));`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(0);
    }
    for (const code of [`[url].forEach(() => window.open(url));`]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
    const logicalLeft = runRule(windowOpenWithoutNoopener, `window.open(url) || reportFailure();`);
    expect(logicalLeft.diagnostics).toHaveLength(0);
  });

  it("distinguishes the global open method from a local shadow", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `function open(value) { return value; }
       open(userControlledUrl);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects name-only member path helpers", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open(attacker.path(userControlledUrl));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a nested write to an iterated config entry", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const links = [{ href: "/safe" }];
       links[0].href = userControlledUrl;
       links.forEach((item) => window.open(item.href));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects nested writes before destructured config iteration", () => {
    for (const code of [
      `const links = [{ href: "/safe" }];
       links[0].href = userControlledUrl;
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       links[index].href = userControlledUrl;
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       const linksAlias = links;
       linksAlias[0].href = userControlledUrl;
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       const entry = links[0];
       entry.href = userControlledUrl;
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       const entry = links[0];
       const entryAlias = entry;
       entryAlias.href = userControlledUrl;
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       const [entry] = links;
       entry.href = userControlledUrl;
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       const linksAlias = links;
       linksAlias.push({ href: userControlledUrl });
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       links[0] = { href: userControlledUrl };
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       const linksAlias = links;
       linksAlias[0] = { href: userControlledUrl };
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       const linksAlias = links;
       linksAlias.splice(0, 1, { href: userControlledUrl });
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       Object.assign(links[0], { href: userControlledUrl });
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       Object.defineProperty(links[0], "href", { value: userControlledUrl });
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       Reflect.set(links[0], "href", userControlledUrl);
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }, { href: "/other" }];
       const [, ...remainingLinks] = links;
       remainingLinks[0].href = userControlledUrl;
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       const alias1 = links;
       const alias2 = alias1;
       const alias3 = alias2;
       const alias4 = alias3;
       const alias5 = alias4;
       const alias6 = alias5;
       const alias7 = alias6;
       const alias8 = alias7;
       const alias9 = alias8;
       const alias10 = alias9;
       alias10[0].href = userControlledUrl;
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach(({ href }, index) => {
         window.open(href);
         if (index === 0) links[1].href = userControlledUrl;
       });`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach((_, index) => {
         const currentEntry = links[index];
         currentEntry.href = userControlledUrl;
         window.open(currentEntry.href);
       });`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach((_, index) => {
         const currentEntry = links[index];
         window.open(currentEntry.href);
         links[index + 1].href = userControlledUrl;
       });`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach((_, index) => {
         const currentEntry = links[index];
         const openCurrentEntry = () => window.open(currentEntry.href);
         currentEntry.href = userControlledUrl;
         openCurrentEntry();
       });`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach((_, index) => {
         const currentEntry = links[index];
         const openCurrentEntry = () => window.open(currentEntry.href);
         const openCurrentEntryAlias = openCurrentEntry;
         currentEntry.href = userControlledUrl;
         openCurrentEntryAlias();
       });`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach((_, index) => {
         const currentEntry = links[index];
         const openCurrentEntry = () => { window.open(currentEntry.href); };
         consume(openCurrentEntry);
         currentEntry.href = userControlledUrl;
       });`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(1);
    }

    for (const code of [
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => { window.open(popupUrl.toString()); };
       openPopup();
       URL.prototype.toString = () => userControlledUrl;
       openPopup();`,
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => { window.open(popupUrl.toString()); };
       URL.prototype.toString = () => userControlledUrl;
       openPopup();
       openPopup();`,
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => { window.open(popupUrl.toString()); };
       consume(openPopup);
       URL.prototype.toString = () => userControlledUrl;`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(1);
    }

    for (const code of [
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => { window.open(popupUrl.toString()); };
       openPopup();
       openPopup();
       URL.prototype.toString = () => userControlledUrl;`,
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => { window.open(popupUrl.toString()); };
       consume(openPopup);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(0);
    }
  });

  it("keeps destructured config iteration safe from irrelevant or later writes", () => {
    for (const code of [
      `const links = [{ href: "/safe", label: "Safe" }];
       links[0].label = userControlledLabel;
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       links.forEach(({ href }) => window.open(href));
       links[0].href = userControlledUrl;`,
      `const links = [{ href: "/safe" }];
       let linksAlias = links;
       linksAlias = [{ href: "/other" }];
       linksAlias[0].href = userControlledUrl;
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach(({ href }, index) => {
         const currentEntry = links[index];
         window.open(href);
         currentEntry.href = userControlledUrl;
       });`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach((_, index) => {
         const currentEntry = links[index];
         window.open(currentEntry.href);
         currentEntry.href = userControlledUrl;
       });`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach(({ href }, index) => {
         window.open(href);
         links[index] = { href: userControlledUrl };
       });`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach((_, index) => {
         const currentEntry = links[index];
         const currentEntryAlias = currentEntry;
         window.open(currentEntryAlias.href);
       });`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach((_, index) => {
         const currentEntry = links[index];
         const openCurrentEntry = () => window.open(currentEntry.href);
         openCurrentEntry();
         currentEntry.href = userControlledUrl;
       });`,
      `const links = [{ href: "/one" }, { href: "/two" }];
       links.forEach((_, index) => {
         const currentEntry = links[index];
         const openCurrentEntry = () => window.open(currentEntry.href);
         openCurrentEntry();
         openCurrentEntry();
         currentEntry.href = userControlledUrl;
       });`,
      `const links = [{ href: "/safe", label: "Safe" }];
       Object.assign(links[0], { label: userControlledLabel });
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe", label: "Safe" }];
       Object.defineProperty(links[0], "label", { value: userControlledLabel });
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe", label: "Safe" }];
       Reflect.set(links[0], "label", userControlledLabel);
       links.forEach(({ href }) => window.open(href));`,
      `const links = [{ href: "/safe" }];
       links.forEach(({ href }) => window.open(href));
       Object.assign(links[0], { href: userControlledUrl });`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(0);
    }
  });

  it("fails closed when indexed-entry opener helpers escape exact direct calls", () => {
    for (const code of [
      `const links=[{href:"/a"}];links.forEach((_,i)=>{const e=links[i];e.href=user;(()=>window.open(e.href))();});`,
      `const links=[{href:"/a"}];links.forEach((_,i)=>{const e=links[i];const f=()=>window.open(e.href);const handlers=[f];e.href=user;consume(handlers);});`,
      `const links=[{href:"/a"}];links.forEach((_,i)=>{const e=links[i];const f=()=>window.open(e.href);const handlers={f};e.href=user;consume(handlers);});`,
      `const links=[{href:"/a"}];links.forEach((_,i)=>{const e=links[i];const f=()=>window.open(e.href);return f;});`,
      `const links=[{href:"/a"}];links.forEach((_,i)=>{const e=links[i];const f=()=>window.open(e.href);setTimeout(f,0);e.href=user;});`,
      `const links=[{href:"/a"}];links.forEach((_,i)=>{const e=links[i];const f=()=>window.open(e.href);e.href=user;setTimeout(f,0);});`,
      `const links=[{href:"/a"}];links.forEach((_,i)=>{const e=links[i];const f=()=>window.open(e.href);let a=f;e.href=user;a();});`,
      `const links=[{href:"/a"}];links.forEach((_,i)=>{const e=links[i];const f=()=>window.open(e.href);const bound=f.bind(null);e.href=user;bound();});`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(1);
    }
  });

  it("trusts an indexed-entry IIFE that runs before the current entry changes", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const links=[{href:"/a"}];links.forEach((_,i)=>{const e=links[i];(()=>window.open(e.href))();e.href=user;});`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects leading template bases that can end in a slash", () => {
    for (const code of [
      'const prefix = "/"; window.open(`${prefix}/evil.com`);',
      'const getPrefix = () => "/"; window.open(`${getPrefix()}/evil.com`);',
      'const prefix = "  /  "; window.open(`${prefix}/evil.com`);',
      'const prefix = "\\\\"; window.open(`${prefix}/evil.com`);',
      'const prefix = condition ? "/api/v1/" : "/"; window.open(`${prefix}/users`);',
      'const getPrefix = () => condition ? "/api/v1/" : "/"; window.open(`${getPrefix()}/users`);',
      'const prefix = "https://"; window.open(`${prefix}/users`);',
      'const prefix = "  WSS:\\\\  "; window.open(`${prefix}/users`);',
      'const prefix = ""; window.open(`${prefix}/${userControlledPath}`);',
      'const prefix = "   "; window.open(`${prefix}/${userControlledPath}`);',
      'const prefix = "h\\nttps:"; window.open(`${prefix}/${userControlledPath}`);',
      'const prefix = "ht\\ttps:"; window.open(`${prefix}/${userControlledPath}`);',
      'const prefix = "http:\\n\\\\"; window.open(`${prefix}/${userControlledPath}`);',
      'const prefix = "\\u0000"; window.open(`${prefix}/${userControlledPath}`);',
      'const prefix = "\\u001f"; window.open(`${prefix}/${userControlledPath}`);',
      "const prefix = /\\//; window.open(`${prefix}/evil.com`);",
      "const prefix = /\\\\/; window.open(`${prefix}/evil.com`);",
      'const prefix = ["/"]; window.open(`${prefix}/evil.com`);',
      'const prefix = { toString: () => "/" }; window.open(`${prefix}/evil.com`);',
      'const prefix = dynamicPrefix || "/api/v1/"; window.open(`${prefix}/users`);',
      'const prefix = dynamicPrefix ?? "/api/v1/"; window.open(`${prefix}/users`);',
      "window.open(`${dynamicPrefix}/users`);",
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("accepts slash-joined bases that cannot collapse to a protocol-relative URL", () => {
    for (const code of [
      'const prefix = "/api/v1/"; window.open(`${prefix}/users`);',
      'const getPrefix = () => "/api/v1/"; window.open(`${getPrefix()}/users`);',
      'const prefix = "/api/v1/" as const; window.open(`${prefix}/users`);',
      'const prefix = condition ? "/api/v1/" : "/api/v2/"; window.open(`${prefix}/users`);',
      'const getPrefix = () => condition ? "/api/v1/" : "/api/v2/"; window.open(`${getPrefix()}/users`);',
      'const prefix = "https://example.com/"; window.open(`${prefix}/users`);',
      'const prefix = condition && "/api/v1/"; window.open(`${prefix}/users`);',
      'const prefix = false && "/"; window.open(`${prefix}/users`);',
      'const prefix = null ?? "/api/v1/"; window.open(`${prefix}/users`);',
      'const prefix = true || "/"; window.open(`${prefix}/users`);',
      'const prefix = false ?? "/"; window.open(`${prefix}/users`);',
      'const prefix = 0 ?? "/"; window.open(`${prefix}/users`);',
      "const prefix = false; window.open(`${prefix}/users`);",
      "const prefix = 0; window.open(`${prefix}/users`);",
      "const prefix = null; window.open(`${prefix}/users`);",
      'const prefix = "h\\vttps:"; window.open(`${prefix}/${userControlledPath}`);',
      'const prefix = "h\\fttps:"; window.open(`${prefix}/${userControlledPath}`);',
      'const prefix = true ? "/api/v1/" : "/"; window.open(`${prefix}/users`);',
      'const root = "/api/v1/"; const a1 = root; const a2 = a1; const a3 = a2; const a4 = a3; const a5 = a4; const a6 = a5; const a7 = a6; const a8 = a7; const a9 = a8; window.open(`${a9}/users`);',
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(0);
    }
  });

  it("rejects replaced URL globals and URL serialization methods", () => {
    for (const code of [
      `globalThis.URL = FakeURL;
       window.open(URL.createObjectURL(blob));`,
      `const popupUrl = new URL("/safe", window.origin);
       popupUrl.toString = () => userControlledUrl;
       window.open(popupUrl.toString());`,
      `const popupUrl = new URL("/safe", window.origin);
       popupUrl.toJSON = () => userControlledUrl;
       window.open(popupUrl.toJSON());`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("rejects destructuring and iteration writes to a let destination", () => {
    for (const code of [
      `let popupUrl = "/safe";
       [popupUrl] = [userControlledUrl];
       window.open(popupUrl);`,
      `let popupUrl = "/safe";
       for (popupUrl of userControlledUrls) break;
       window.open(popupUrl);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("does not trust builder names or safe-looking first arguments", () => {
    for (const code of [
      `window.open(attacker.buildURL("/safe", userControlledUrl));`,
      `window.open(attacker.fullPath("/safe", userControlledUrl));`,
      `const fullPath = () => userControlledUrl;
       window.open(fullPath("/safe"));`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("rejects a reassigned getLocation function", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `function getLocation() { return window.location; }
       getLocation = () => ({ href: userControlledUrl });
       window.open(getLocation().href);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat partial opaque feature entries as opener protection", () => {
    for (const features of [
      `\`no\${dynamicText}opener\``,
      `\`width=\${dynamicWidth}\``,
      `\`width=5\${dynamicWidth}\``,
      `\`\${dynamicPrefix}width=500\``,
      `\`\${dynamicName}=false\``,
      `\`noopener=false,width=\${dynamicWidth}\``,
    ]) {
      const unsafe = runRule(windowOpenWithoutNoopener, `window.open(url, "_blank", ${features});`);
      expect(unsafe.diagnostics).toHaveLength(1);
    }
    const safe = runRule(
      windowOpenWithoutNoopener,
      'window.open(url, "_blank", `noopener,width=${dynamicWidth}`);',
    );
    expect(safe.diagnostics).toHaveLength(0);
  });

  it("accepts only the default Router export or useRouter hook", () => {
    for (const code of [
      `import { useParams as Router } from "next/navigation";
       const openDestination = (destination, newTab) => {
         if (newTab) window.open(destination);
         else Router.push(destination);
       };`,
      `import { withRouter as Router } from "next/router";
       const openDestination = (destination, newTab) => {
         if (newTab) window.open(destination);
         else Router.push(destination);
       };`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("requires proven built-ins to discard callback returns", () => {
    for (const code of [
      `const items = { forEach(callback) { return callback(); } };
       const popup = items.forEach(() => window.open(url));`,
      `const setTimeout = (callback) => callback();
       const popup = setTimeout(() => window.open(url));`,
      `const handlers = { onClick: () => window.open(url) };
       const popup = handlers.onClick();`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("rejects imported URL names when their values cannot be resolved", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `import { CHANGELOG_URL } from "./missing";
       window.open(CHANGELOG_URL);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects writes to parameter-derived destination proofs", () => {
    for (const code of [
      `const openLink = (url) => {
         url = userControlledUrl;
         window.open(url);
       };
       openLink("/safe");`,
      `const C = ({ href }) => {
         href = userControlledUrl;
         return <button onClick={() => window.open(href)} />;
       };
       const App = () => <C href="/safe" />;`,
      `const links = [{ href: "/safe" }];
       links.forEach((item) => {
         item = { href: userControlledUrl };
         window.open(item.href);
       });`,
      `const links = [{ href: "/safe" }];
       links.forEach(({ href }) => {
         href = userControlledUrl;
         window.open(href);
       });`,
      `const openAnchor = (anchor) => {
         anchor = { href: userControlledUrl };
         window.open(anchor.href);
       };
       const C = () => <a href="/safe" onClick={(event) => openAnchor(event.currentTarget)} />;`,
      `import Router from "next/router";
       const openDestination = (destination, newTab) => {
         destination = userControlledUrl;
         if (newTab) window.open(destination);
         else Router.push(destination);
       };`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("stays quiet when a nested opener is synchronously called before an outer write", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const openDestination = (destination) => {
         const run = () => {
           window.open(destination);
         };
         run();
         destination = userControlledUrl;
       };
       openDestination('/safe');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when an inline synchronous opener runs before an outer write", () => {
    for (const code of [
      `const openDestination = (destination) => {
         (() => {
           window.open(destination);
         })();
         destination = userControlledUrl;
       };
       openDestination('/safe');`,
      `const openDestination = (destination) => {
         [1].forEach(() => {
           window.open(destination);
         });
         destination = userControlledUrl;
       };
       openDestination('/safe');`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("rejects structural mutations to trusted array configs", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const links = [{ href: "/safe" }];
       links.push({ href: userControlledUrl });
       links.forEach((item) => window.open(item.href));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects destructuring writes after trusted let assignments", () => {
    for (const code of [
      `let popupUrl;
       popupUrl = "/safe";
       [popupUrl] = [userControlledUrl];
       window.open(popupUrl);`,
      `let popupUrl;
       popupUrl = "/safe";
       ({ popupUrl } = { popupUrl: userControlledUrl });
       window.open(popupUrl);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("accepts parameter-led local helper concatenations with pinned destinations", () => {
    for (const code of [
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("/safe", userControlledId));`,
      `const buildPath = (path, dataId) => path + "" + "/" + dataId;
       window.open(buildPath("/safe", userControlledId));`,
      `const buildPath = (path, dataId) => path + \`/item/\` + dataId;
       window.open(buildPath("/safe", userControlledId));`,
      `const buildQuery = (path, query) => path + "?q=" + query;
       window.open(buildQuery("/safe", userControlledQuery));`,
      `const buildHash = (path, hash) => path + "#" + hash;
       const safePath = "/safe";
       window.open(buildHash(safePath, userControlledHash));`,
      `const buildPath = (path, hostname) => path + "/" + hostname;
       window.open(buildPath("h\\vttps:", "/evil.example"));`,
      `const buildPath = (path, hostname) => path + "/" + hostname;
       window.open(buildPath("h\\fttps:", "/evil.example"));`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(0);
    }
  });

  it("rejects local helper concatenations without a pinned destination boundary", () => {
    for (const code of [
      `const buildPath = (path, dataId) => path + dataId;
       window.open(buildPath("/safe", userControlledId));`,
      `const buildPath = (path, dataId) => path + dynamicSeparator + dataId;
       window.open(buildPath("/safe", userControlledId));`,
      `const buildPath = (path, hostname) => path + "/" + hostname;
       window.open(buildPath("/", "evil.example.com"));`,
      `const buildPath = (path, hostname) => path + "/" + hostname;
       window.open(buildPath("https://", "evil.example.com"));`,
      `const buildPath = (path, dataId) => path + "//" + dataId;
       window.open(buildPath("/safe", userControlledId));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("", userControlledId));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("   ", userControlledId));`,
      `const buildPath = (path, dataId) => path + ("/" + dataId);
       window.open(buildPath("", userControlledId));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("h\\nttps:", "/evil.example"));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("h\\rttps:", "/evil.example"));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("ht\\ttps:", "/evil.example"));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("ht\\ntp:", "/evil.example"));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("f\\ntp:", "/evil.example"));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("http:\\n\\\\", "evil.example"));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("\\u0000", "/evil.example"));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("\\u0001", "/evil.example"));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("\\b", "/evil.example"));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath("\\u001f", "/evil.example"));`,
      `const buildPath = (path, dataId) => path + "/" + dataId;
       window.open(buildPath(userControlledUrl, dataId));`,
      `const buildPath = (path, dataId) => {
         path = userControlledUrl;
         return path + "/" + dataId;
       };
       window.open(buildPath("/safe", dataId));`,
      `const buildPath = (path, dataId) => {
         [path] = [userControlledUrl];
         return path + "/" + dataId;
       };
       window.open(buildPath("/safe", dataId));`,
      `const buildPath = (path, dataId) => {
         ({ path } = { path: userControlledUrl });
         return path + "/" + dataId;
       };
       window.open(buildPath("/safe", dataId));`,
      `const buildPath = (path, dataId) => {
         [[path]] = [[userControlledUrl]];
         return path + "/" + dataId;
       };
       window.open(buildPath("/safe", dataId));`,
      `const buildPath = (path, dataId) => {
         [path = userControlledUrl] = [];
         return path + "/" + dataId;
       };
       window.open(buildPath("/safe", dataId));`,
      `const buildPath = (path, dataId) => {
         [...path] = [userControlledUrl];
         return path + "/" + dataId;
       };
       window.open(buildPath("/safe", dataId));`,
      `const buildPath = (path, dataId) => {
         ({ value: { path } } = { value: { path: userControlledUrl } });
         return path + "/" + dataId;
       };
       window.open(buildPath("/safe", dataId));`,
      `const buildPath = (path, dataId) => {
         ({ value: path = userControlledUrl } = {});
         return path + "/" + dataId;
       };
       window.open(buildPath("/safe", dataId));`,
      `const buildPath = (path, dataId) => {
         if (condition) return path + "/" + dataId;
         return userControlledUrl;
       };
       window.open(buildPath("/safe", dataId));`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(1);
    }
  });

  it("rejects local helper parameters reassigned before return", () => {
    for (const code of [
      `const buildPath = (path) => {
         path = userControlledUrl;
         return path;
       };
       window.open(buildPath("/safe"));`,
      `const buildPath = (path, dataId) => {
         [path] = [userControlledUrl];
         return \`${"${path}"}/${"${dataId}"}\`;
       };
       window.open(buildPath("/safe", dataId));`,
      `const buildPath = (path, dataId) => {
         ({ path } = { path: userControlledUrl });
         return \`${"${path}"}/${"${dataId}"}\`;
       };
       window.open(buildPath("/safe", dataId));`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(1);
    }
  });

  it("rejects URL prototype serializer mutations", () => {
    for (const code of [
      `URL.prototype.toString = () => userControlledUrl;
       const popupUrl = new URL("/safe", window.origin);
       window.open(popupUrl.toString());`,
      `const popupUrl = new URL("/safe", window.origin);
       URL.prototype.toString = () => userControlledUrl;
       window.open(popupUrl.toString());`,
      `const popupUrl = new URL("/safe", window.origin);
       URL.prototype.toJSON = () => userControlledUrl;
       window.open(popupUrl.toJSON());`,
      `const popupUrl = new URL("/safe", window.origin);
       URL.prototype.href = userControlledUrl;
       window.open(popupUrl.href);`,
      `const popupUrl = new URL("/safe", window.origin);
       URL.prototype.toString = () => userControlledUrl;
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       URL.prototype.toString = () => userControlledUrl;
       window.open(\`\${popupUrl}\`);`,
      `const popupUrl = new URL("/safe", window.origin);
       const popupAlias = popupUrl;
       URL.prototype.toString = () => userControlledUrl;
       window.open(popupAlias);`,
      `const popupUrl = new URL("/safe", window.origin);
       const popupAlias = popupUrl;
       URL.prototype.toString = () => userControlledUrl;
       window.open(\`\${popupAlias}\`);`,
      `const popupUrl = new URL("/safe", window.origin);
       const popupAlias = condition ? popupUrl : null;
       URL.prototype.toString = () => userControlledUrl;
       window.open(popupAlias);`,
      `const popupUrl = new URL("/safe", window.origin);
       const popupUrls = [popupUrl];
       URL.prototype.toString = () => userControlledUrl;
       window.open(popupUrls[0]);`,
      `const popupUrl = new URL("/safe", window.origin);
       const popupUrls = { safe: popupUrl };
       URL.prototype.toString = () => userControlledUrl;
       window.open(popupUrls.safe);`,
      `const popupUrl = new URL("/safe", window.origin);
       const getShareUrl = () => popupUrl;
       URL.prototype.toString = () => userControlledUrl;
       window.open(getShareUrl());`,
      `const popupUrl = new URL("/safe", window.origin);
       const getShareUrl = () => popupUrl.toString();
       URL.prototype.toString = () => userControlledUrl;
       window.open(getShareUrl());`,
      `const popupUrl = new URL("/safe", window.origin);
       const getShareUrl = () => popupUrl.toJSON();
       URL.prototype.toJSON = () => userControlledUrl;
       window.open(getShareUrl());`,
      `const popupUrl = new URL("/safe", window.origin);
       const getShareUrl = () => popupUrl.href;
       URL.prototype.href = userControlledUrl;
       window.open(getShareUrl());`,
      `const popupUrl = new URL("/safe", window.origin);
       const getShareUrl = () => \`\${popupUrl}\`;
       URL.prototype.toString = () => userControlledUrl;
       window.open(getShareUrl());`,
      `const popupUrl = new URL("/safe", window.origin);
       const popupAlias = popupUrl;
       popupUrl.href = userControlledUrl;
       window.open(popupAlias);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(1);
    }
  });

  it("preserves URL serialization snapshots made before prototype mutations", () => {
    for (const code of [
      `const popupUrl = new URL("/safe", window.origin);
       const serializedPopupUrl = popupUrl.toString();
       URL.prototype.toString = () => userControlledUrl;
       window.open(serializedPopupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const popupHref = popupUrl.href;
       URL.prototype.href = userControlledUrl;
       window.open(popupHref);`,
      `const popupUrl = new URL("/safe", window.origin);
       const serializedPopupUrl = \`\${popupUrl}\`;
       URL.prototype.toString = () => userControlledUrl;
       window.open(serializedPopupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const getShareUrl = () => popupUrl.toString();
       const serializedPopupUrl = getShareUrl();
       URL.prototype.toString = () => userControlledUrl;
       window.open(serializedPopupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const getShareUrl = () => popupUrl.toJSON();
       const serializedPopupUrl = getShareUrl();
       URL.prototype.toJSON = () => userControlledUrl;
       window.open(serializedPopupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const getShareUrl = () => popupUrl.href;
       const popupHref = getShareUrl();
       URL.prototype.href = userControlledUrl;
       window.open(popupHref);`,
      `const popupUrl = new URL("/safe", window.origin);
       const getShareUrl = () => \`\${popupUrl}\`;
       const serializedPopupUrl = getShareUrl();
       URL.prototype.toString = () => userControlledUrl;
       window.open(serializedPopupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const serializePopupUrl = () => popupUrl.toString();
       const getShareUrl = () => serializePopupUrl();
       const serializedPopupUrl = getShareUrl();
       window.open(serializedPopupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const serializedPopupUrl = getShareUrl();
       URL.prototype.toString = () => userControlledUrl;
       function getShareUrl() {
         return popupUrl.toString();
       }
       window.open(serializedPopupUrl);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(0);
    }
  });

  it("scopes local invocation references to one opener analysis", () => {
    for (const code of [
      `const popupUrl = new URL("/safe", window.origin);
       const openFirst = () => window.open("/safe");
       openFirst();
       URL.prototype.toString = () => userControlledUrl;
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       (() => window.open("/safe"))();
       URL.prototype.href = userControlledUrl;
       window.open(popupUrl.href);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(1);
    }

    for (const code of [
      `const popupUrl = new URL("/safe", window.origin);
       const serializedPopupUrl = popupUrl.toString();
       URL.prototype.toString = () => userControlledUrl;
       const openFirst = () => window.open("/safe");
       openFirst();
       window.open(serializedPopupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const popupHref = popupUrl.href;
       URL.prototype.href = userControlledUrl;
       (() => window.open("/safe"))();
       window.open(popupHref);`,
      `const popupUrl = new URL("/safe", window.origin);
       const serializedPopupUrl = popupUrl.toString();
       URL.prototype.toString = () => userControlledUrl;
       const openSnapshot = () => window.open(serializedPopupUrl);
       openSnapshot();`,
      `const popupUrl = new URL("/safe", window.origin);
       const popupHref = popupUrl.href;
       URL.prototype.href = userControlledUrl;
       const openSnapshot = () => window.open(popupHref);
       openSnapshot();`,
      `const popupUrl = new URL("/safe", window.origin);
       const serializedPopupUrl = popupUrl.toJSON();
       URL.prototype.toJSON = () => userControlledUrl;
       const openSnapshot = () => window.open(serializedPopupUrl);
       openSnapshot();`,
      `const popupUrl = new URL("/safe", window.origin);
       const serializedPopupUrl = \`\${popupUrl}\`;
       URL.prototype.toString = () => userControlledUrl;
       const openSnapshot = () => window.open(serializedPopupUrl);
       openSnapshot();`,
      `const run = () => {
         const popupUrl = new URL("/safe", window.origin);
         const serializedPopupUrl = popupUrl.toString();
         URL.prototype.toString = () => userControlledUrl;
         const openSnapshot = () => window.open(serializedPopupUrl);
         openSnapshot();
       };
       run();`,
      `const popupUrl = new URL("/safe", window.origin);
       const serializedPopupUrl = popupUrl.toString();
       const firstAlias = serializedPopupUrl;
       const secondAlias = firstAlias;
       URL.prototype.toString = () => userControlledUrl;
       const openSnapshot = () => window.open(secondAlias);
       openSnapshot();`,
      `const popupUrl = new URL("/safe", window.origin);
       const outer = () => {
         const serializedPopupUrl = popupUrl.toString();
         const inner = () => window.open(serializedPopupUrl);
         inner();
       };
       outer();
       URL.prototype.toString = () => userControlledUrl;`,
      `const popupUrl = new URL("/safe", window.origin);
       [1].forEach(() => window.open(popupUrl.toString()));
       URL.prototype.toString = () => userControlledUrl;`,
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => window.open(popupUrl.toString());
       openPopup();
       popupUrl.toString = () => userControlledUrl;`,
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => window.open(popupUrl.toJSON());
       openPopup();
       popupUrl.toJSON = () => userControlledUrl;`,
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => window.open(popupUrl.href);
       openPopup();
       popupUrl.href = userControlledUrl;`,
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => window.open(popupUrl.toString());
       openPopup();
       Object.defineProperty(popupUrl, "toString", { value: () => userControlledUrl });`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(0);
    }

    for (const code of [
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => window.open(popupUrl.toString());
       URL.prototype.toString = () => userControlledUrl;
       openPopup();`,
      `const popupUrl = new URL("/safe", window.origin);
       const serializePopupUrl = () => popupUrl.toJSON();
       const openPopup = () => window.open(serializePopupUrl());
       URL.prototype.toJSON = () => userControlledUrl;
       openPopup();`,
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => {
         const serializedPopupUrl = popupUrl.toString();
         window.open(serializedPopupUrl);
       };
       URL.prototype.toString = () => userControlledUrl;
       openPopup();`,
      `const popupUrl = new URL("/safe", window.origin);
       const outer = () => {
         const serializedPopupUrl = popupUrl.toString();
         const inner = () => window.open(serializedPopupUrl);
         inner();
       };
       URL.prototype.toString = () => userControlledUrl;
       outer();`,
      `const popupUrl = new URL("/safe", window.origin);
       const outer = () => {
         const popupHref = popupUrl.href;
         const inner = () => window.open(popupHref);
         inner();
       };
       popupUrl.href = userControlledUrl;
       outer();`,
      `const popupUrl = new URL("/safe", window.origin);
       const outer = () => {
         const serializedPopupUrl = popupUrl.toString();
         const inner = () => window.open(serializedPopupUrl);
         inner();
       };
       outer();
       URL.prototype.toString = () => userControlledUrl;
       outer();`,
      `const popupUrl = new URL("/safe", window.origin);
       URL.prototype.toString = () => userControlledUrl;
       [1].forEach(() => window.open(popupUrl.toString()));`,
      `const popupUrl = new URL("/safe", window.origin);
       const openPopup = () => window.open(popupUrl.toString());
       popupUrl.toString = () => userControlledUrl;
       openPopup();`,
      `const popupUrl = new URL("/safe", window.origin);
       const getPopupHref = () => popupUrl.href;
       const openPopup = () => {
         popupUrl.href = userControlledUrl;
         window.open(getPopupHref());
       };
       openPopup();`,
      `const popupUrl = new URL("/safe", window.origin);
       const getPopupUrl = () => popupUrl;
       const openPopup = () => {
         popupUrl.href = userControlledUrl;
         window.open(getPopupUrl());
       };
       openPopup();`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics, code).toHaveLength(1);
    }
  });

  it("does not let URL prototype writes invalidate unrelated string serialization", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const popupPath = "/safe";
       URL.prototype.toString = () => userControlledUrl;
       window.open(popupPath.toString());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat mutations on unrelated destructured URL members as prototype writes", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const popupUrl = new URL("/safe", window.origin);
       const { canParse } = URL;
       canParse.metadata = userControlledValue;
       window.open(popupUrl);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects indirect URL prototype and instance mutation APIs", () => {
    for (const code of [
      `const popupUrl = new URL("/safe", window.origin);
       Object.defineProperty(URL.prototype, "toString", { value: () => userControlledUrl });
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       Object.defineProperties(URL.prototype, {
         toString: { value: () => userControlledUrl },
       });
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       Reflect.defineProperty(URL.prototype, "toJSON", { value: () => userControlledUrl });
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       Object.assign(URL.prototype, { toString: () => userControlledUrl });
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       Object.setPrototypeOf(popupUrl, { toString: () => userControlledUrl });
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       Object.assign(popupUrl, { href: userControlledUrl });
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const popupAlias = popupUrl;
       Object.defineProperty(popupAlias, "toString", { value: () => userControlledUrl });
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const popupAlias = popupUrl;
       Reflect.setPrototypeOf(popupAlias, { toString: () => userControlledUrl });
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const urlPrototype = URL.prototype;
       urlPrototype.toString = () => userControlledUrl;
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const { prototype: urlPrototype } = URL;
       urlPrototype.toString = () => userControlledUrl;
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const defineProperty = Object.defineProperty;
       defineProperty(URL.prototype, "toString", { value: () => userControlledUrl });
       window.open(popupUrl);`,
      `const popupUrl = new URL("/safe", window.origin);
       const { defineProperty } = Object;
       defineProperty(URL.prototype, "toString", { value: () => userControlledUrl });
       window.open(popupUrl);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("does not assume custom JSX handlers discard callback returns", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const Consumer = ({ onClick }) => onClick();
       const App = () => <Consumer onClick={() => window.open(userControlledUrl)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume custom createElement handlers discard callback returns", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const Consumer = ({ onClick }) => onClick();
       const App = () => React.createElement(Consumer, {
         onClick: () => window.open(userControlledUrl),
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume a replaced array forEach method discards callback returns", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const links = [userControlledUrl];
       links.forEach = (callback) => callback(links[0]);
       const popup = links.forEach((href) => window.open(href));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports discarded handles only for proven built-in array receivers", () => {
    for (const code of [
      `const links: string[] = getLinks();
       links.forEach((href) => window.open(href));`,
      `const links = Array.from(getLinks());
       links.forEach((href) => window.open(href));`,
      `const links = new Array(userControlledUrl);
       links.forEach((href) => window.open(href));`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
    const opaqueReceiver = runRule(
      windowOpenWithoutNoopener,
      `const links = getLinks();
       const popup = links.forEach((href) => window.open(href));`,
    );
    expect(opaqueReceiver.diagnostics).toHaveLength(0);
  });

  it("rejects concatenations whose static prefix does not pin the destination", () => {
    for (const code of [
      `window.open("https://" + userControlledHost);`,
      `window.open("//" + userControlledHost);`,
      `window.open("" + userControlledUrl);`,
      `window.open("https://example.com" + userControlledSuffix);`,
      `window.open("/" + userControlledPath);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
    for (const code of [
      `window.open("https://example.com/" + userControlledPath);`,
      `window.open("/safe/" + userControlledPath);`,
      `window.open("./" + userControlledPath);`,
      `window.open("mailto:" + userControlledAddress);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("trusts href reads from unmodified URL instances", () => {
    const trusted = runRule(
      windowOpenWithoutNoopener,
      `const popupUrl = new URL("/safe", window.origin);
       window.open(popupUrl.href);`,
    );
    expect(trusted.diagnostics).toHaveLength(0);
    for (const code of [
      `const popupUrl = new URL("/safe", window.origin);
       popupUrl.href = userControlledUrl;
       window.open(popupUrl.href);`,
      `const URL = FakeURL;
       const popupUrl = new URL("/safe", window.origin);
       window.open(popupUrl.href);`,
    ]) {
      const result = runRule(windowOpenWithoutNoopener, code);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("keeps bare pathname reads diagnostic because they can be protocol-relative", () => {
    const result = runRule(windowOpenWithoutNoopener, `window.open(window.location.pathname);`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
