import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { __clearResolveImportWithOxcCacheForTests } from "../../utils/resolve-import-with-oxc.js";
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
      "window.open(`${fullPath('/dtale/data-export', dataId)}?type=${exportType}`, '_blank');",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a location.pathname-derived URL (open-in-new-tab idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `window.open(getLocation().pathname?.replace('/iframe/', '/main/') ?? '', '_blank');`,
    );
    expect(result.diagnostics).toHaveLength(0);
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
      "window.open(buildForwardURL(getLocation().href, dataId), '_blank');",
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

  it("does not flag a bare open() that is not the window global", () => {
    const result = runRule(windowOpenWithoutNoopener, `open(url, '_blank');`);
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet: Imported URL constant from the app's constants module", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `import { CHANGELOG_URL } from './constants';
const openChangelog = () => {
  window.open(CHANGELOG_URL, '_blank');
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet: Imported camelCase URL constant (AppFlowy downloadPage idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `import { downloadPage } from '@/utils/url';
window.open(downloadPage);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Const bound to a path-builder call with a dynamic path argument (dtale popup idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const openTab = (path) => {
  const url = fullPath(path, dataId);
  window.open(url, '_blank', \`titlebar=1,location=1,status=1,width=\${width},height=\${height}\`);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: URL builder wrapping a path-builder call (dtale export idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const exportHTML = () => {
  const url = buildURL(fullPath(DATA_ENDPOINT, dataId), { export: true });
  window.open(url, '_blank');
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Sync get…Url route-builder helper (AppFlowy open-in-new-tab idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `const onSelect = () => {
  const url = getViewUrl(view, currentWorkspaceId);
  if (!url) return;
  window.open(url, '_blank');
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Direct get…Url call with a modifier-key target ternary (jaeger deep-deps idiom)", () => {
    const result = runRule(
      windowOpenWithoutNoopener,
      `function viewAllDep({ ctrlKey, metaKey }) {
  window.open(getUrl({ density, operation }), ctrlKey || metaKey ? '_blank' : '_self');
}`,
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet: useState whose only setters pass same-file path-builder URLs (dtale MissingNoCharts idiom)", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet: anchorEl.href helper fed e.currentTarget from an inline handler on a trusted-href link (react-cosmos idiom)", () => {
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
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: anchorEl.href helper reached through a named handler wired to a trusted-href link (react-cosmos bookmarks idiom)", () => {
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
      `export function ListingRow({ href, name }) {
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
    // realpathSync: oxc-resolver returns real paths, and os.tmpdir() is a
    // symlink on macOS (/var -> /private/var).
    temporaryDirectory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "rd-window-open-xfile-")),
    );
    __clearResolveImportWithOxcCacheForTests();
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

  it("stays quiet: imported build…Url helper whose every return is same-origin-built (dtale CorrelationsGrid idiom)", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet: unresolvable import with a URL-suffixed name falls back to the name heuristic", () => {
    const result = runRuleAt(
      "src/App.tsx",
      "import { downloadPage } from './missing-config';\nwindow.open(downloadPage, '_blank');\n",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps the name heuristic unchanged when the host provides no filename", () => {
    writeFile(
      "src/config.ts",
      "export const downloadPage = 'https://downloads.example.com/latest';\n",
    );
    const result = runRule(
      windowOpenWithoutNoopener,
      "import { downloadPage } from './config';\nwindow.open(downloadPage, '_blank');\n",
      { filename: undefined },
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("caps cross-file resolutions per linted file and falls back to the name heuristic past the cap", () => {
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
    expect(result.diagnostics).toHaveLength(3);
  });
});
