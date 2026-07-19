import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedThrowingParseCall } from "./no-unguarded-throwing-parse-call.js";

describe("no-unguarded-throwing-parse-call", () => {
  it("does not flag new URL of a template pinned to window.location.origin", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Sidebar({ match }) {
        const url = new URL(\`\${window.location.origin}/user/conversations/\${match.params.conversationId}\`);
        return <a href={url.href}>Open</a>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags decodeURIComponent of a useParams path in a component body", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function RawFileViewer(params) {
        const path = decodeURIComponent(params.path);
        return path;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags decodeURIComponent of a searchParams value", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Page() {
        const target = decodeURIComponent(searchParams.get("redirect"));
        return target;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for values produced by built-in URI encoders", () => {
    const directResult = runRule(
      noUnguardedThrowingParseCall,
      `function Page(params) {
        return decodeURIComponent(encodeURIComponent(params.path));
      }`,
    );
    const searchParamsResult = runRule(
      noUnguardedThrowingParseCall,
      `function Page() {
        return decodeURI(encodeURI(searchParams.get("redirect")));
      }`,
    );
    const aliasResult = runRule(
      noUnguardedThrowingParseCall,
      `function Page() {
        const encodedHash = encodeURIComponent(location.hash);
        return decodeURIComponent(encodedHash);
      }`,
    );
    expect(directResult.diagnostics).toHaveLength(0);
    expect(searchParamsResult.diagnostics).toHaveLength(0);
    expect(aliasResult.diagnostics).toHaveLength(0);
  });

  it("does not trust shadowed or transformed URI encoder calls", () => {
    const shadowedResult = runRule(
      noUnguardedThrowingParseCall,
      `function Page(params, encodeURIComponent) {
        return decodeURIComponent(encodeURIComponent(params.path));
      }`,
    );
    const transformedResult = runRule(
      noUnguardedThrowingParseCall,
      `function Page(params) {
        return decodeURIComponent(encodeURIComponent(params.path).slice(1));
      }`,
    );
    expect(shadowedResult.diagnostics).toHaveLength(1);
    expect(transformedResult.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a shadowed decode helper", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Page(params, decodeURIComponent) {
        return decodeURIComponent(params.path);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags location href values that can preserve malformed percent escapes", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Page() {
        return [decodeURIComponent(location.href), decodeURIComponent(window.location.href)];
      }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags decodeURIComponent of a bare route param named branch", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const getDecodedBranch = (branch) =>
        branch ? decodeURIComponent(branch) : undefined;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags decodeURIComponent of a local traced back to searchParams.get", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function AsTemplatePage() {
        const viewName = searchParams.get("viewName");
        return viewName ? decodeURIComponent(viewName) : "";
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags decoded static segments from a custom citation href", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function parseCitationHref(href) {
        if (!href.startsWith(\`\${CITATION_URL_SCHEME}://\`)) return null;
        const rest = href.slice(\`\${CITATION_URL_SCHEME}://\`.length);
        const parts = rest.split("/");
        const title = parts[3] ? decodeURIComponent(parts[3]) : "";
        const quote = parts[4] ? decodeURIComponent(parts[4]) : undefined;
        return { title, quote };
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet for a decoded static segment from an arbitrary token", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function parseToken(token) {
        const parts = token.slice(4).split("/");
        return decodeURIComponent(parts[3]);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a dynamically selected segment from an href", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function parseHref(href, index) {
        const parts = href.slice(4).split("/");
        return decodeURIComponent(parts[index]);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when an unknown helper produces href segments", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function parseHref(href) {
        const parts = tokenize(href);
        return decodeURIComponent(parts[3]);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for decoded segments from a compile-time href", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function parseFixedHref() {
        const href = "app://fixed";
        const parts = href.split("/");
        return decodeURIComponent(parts[3]);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for decoded segments from a local config href", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function parseFixedHref() {
        const config = { href: "app://fixed" };
        const parts = config.href.split("/");
        return decodeURIComponent(parts[3]);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet after a URL-derived alias is reassigned", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function parseHref(href) {
        let rest = href.slice(6);
        rest = "good";
        const parts = rest.split("/");
        return decodeURIComponent(parts[3]);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet after an href parameter is reassigned to encoded input", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function parseHref(href) {
        href = encodeURIComponent(href);
        const parts = href.split("/");
        return decodeURIComponent(parts[3]);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves captured href provenance across later writes", () => {
    const parameterWrittenAfterDecode = runRule(
      noUnguardedThrowingParseCall,
      `function parseHref(href) {
        const parts = href.split("/");
        const title = decodeURIComponent(parts[3]);
        href = "safe";
        return title;
      }`,
    );
    const parameterWrittenAfterCapture = runRule(
      noUnguardedThrowingParseCall,
      `function parseHref(href) {
        const parts = href.split("/");
        href = "safe";
        return decodeURIComponent(parts[3]);
      }`,
    );
    const aliasWrittenAfterDecode = runRule(
      noUnguardedThrowingParseCall,
      `function parseHref(href) {
        let rest = href.slice(6);
        const parts = rest.split("/");
        const title = decodeURIComponent(parts[3]);
        rest = "safe";
        return title;
      }`,
    );
    expect(parameterWrittenAfterDecode.diagnostics).toHaveLength(1);
    expect(parameterWrittenAfterCapture.diagnostics).toHaveLength(1);
    expect(aliasWrittenAfterDecode.diagnostics).toHaveLength(1);
  });

  it("preserves established route-hook source roots", () => {
    const paramsResult = runRule(
      noUnguardedThrowingParseCall,
      `function Page() {
        const params = useParams();
        return decodeURIComponent(params.path);
      }`,
    );
    const searchParamsResult = runRule(
      noUnguardedThrowingParseCall,
      `function Page() {
        const searchParams = useSearchParams();
        return decodeURIComponent(searchParams.get("next"));
      }`,
    );
    const locationResult = runRule(
      noUnguardedThrowingParseCall,
      `function Page() {
        const location = useLocation();
        return decodeURIComponent(location.hash);
      }`,
    );
    expect(paramsResult.diagnostics).toHaveLength(1);
    expect(searchParamsResult.diagnostics).toHaveLength(1);
    expect(locationResult.diagnostics).toHaveLength(1);
  });

  it("flags readableColor of a runtime theme color in a hook", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function useGetContrastTextColor(actualColorForReadable) {
        const contrast = readableColor(actualColorForReadable);
        return contrast;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags chroma of a color prop member in render", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Swatch(props) {
        return chroma(props.color).hex();
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a shadowed local color helper", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const chroma = (value) => ({ hex: () => value }); function Swatch(props) { return chroma(props.color).hex(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a shadowed local URL constructor", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `class URL { constructor(value) { this.value = value; } } function Page({ params }) { return new URL(params.path); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a URL parse behind an unrelated validity check", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Page({ params, schema }) { if (schema.valid(params.path)) return new URL(params.path); return null; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a URL parse in the invalid branch of URL.canParse", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Page({ params }) { if (!URL.canParse(params.path)) return new URL(params.path); return null; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags chroma of a getComputedStyle custom-property read", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function useAccentColor(element) {
        const accent = getComputedStyle(element).getPropertyValue("--accent");
        return chroma(accent).hex();
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for chroma of a useTheme design-token member", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function EmojiPicker() {
        const theme = useTheme();
        const pickerCssVariables = useMemo(
          () => ({
            accent: chroma(theme.colorPrimary).rgb().join(", "),
            background: chroma(theme.colorBgElevated).rgb().join(", "),
          }),
          [theme.colorPrimary, theme.colorBgElevated],
        );
        return pickerCssVariables;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for readableColor of a custom-named useTheme token object", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Badge() {
        const appTheme = useTheme();
        return readableColor(appTheme.colorText);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for chroma of an antd theme.useToken() token member", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Tag() {
        const { token } = theme.useToken();
        return chroma(token.colorPrimary).alpha(0.4).hex();
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a single-argument new URL of a searchParams value", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function open(searchParams) {
        return new URL(searchParams.get("redirect"));
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for new URL of a bare url parameter (name alone is not evidence)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function open(url) {
        return new URL(url);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a library option URL with a valid location fallback", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `class Editor {
        navigateToDeepLink(options?: { url?: string | URL }) {
          return new URL(options?.url ?? window.location.href);
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL of a url parameter inside a Promise executor", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function httpGet(url, redirectsLeft) {
        return new Promise((resolve, reject) => {
          const parsedUrl = new URL(url);
          resolve(parsedUrl.protocol);
        });
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL of a url parameter in an async upload callback", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const upload = async (url) => {
        const useProxy = !new URL(url).hostname.includes("internxt");
        return useProxy;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags new URL of a local traced back to a searchParams read", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Redirect() {
        const target = searchParams.get("next");
        return new URL(target);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags new URL of window.location.pathname (relative, throws)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function readParams() {
        return new URL(window.location.pathname);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for new URL with a base-origin second argument", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function middleware(request, path) {
        return NextResponse.redirect(new URL(path, request.url));
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL of window.location.href", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function readParams() {
        return new URL(window.location.href);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL of a framework request.url", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function handler(request) {
        const { searchParams } = new URL(request.url);
        return searchParams;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL of a page.url() accessor", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function origin(page) {
        return new URL(page.url()).origin;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags new URL of location.pathname (not an absolute URL, throws)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function readParams() {
        return new URL(location.pathname);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags new URL of a deep request chain (user-controlled)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function handler(request) {
        return new URL(request.body.url);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for new URL of a module constant / env base", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const endpoint = new URL("/api/users", process.env.PUBLIC_URL);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the decode is inside a try/catch", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function decode(redirectTo) {
        try {
          return decodeURIComponent(redirectTo);
        } catch {
          return null;
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let an outer try suppress a deferred decode callback", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `try { Promise.resolve().then(() => decodeURIComponent(window.location.hash)); } catch { recover(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps synchronous array callbacks protected by an outer try", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `try { values.map(() => decodeURIComponent(window.location.hash)); } catch { recover(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat the same try statement as protection inside its catch", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `try { work(); } catch { decodeURIComponent(window.location.hash); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a safe-named helper that does not actually catch parser errors", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function safeReadableColor(color) {
        return readableColor(color);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for color parse work in a scripts/ file", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function mix(paletteHex) {
        return chroma(paletteHex).mix("red");
      }`,
      { filename: "scripts/mixColorPalettes.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for decodeURIComponent of a string literal", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const value = decodeURIComponent("%20fixed%20");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for decodeURIComponent of a non-URL local variable", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function run(token) {
        return decodeURIComponent(token);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL(import.meta.url), the ESM __dirname idiom", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const currentDirectory = new URL(import.meta.url).pathname;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL(window.location), MDN's canonical Location-stringify example", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function share() {
        const url = new URL(window.location);
        url.searchParams.set("tab", "1");
        return url;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL(location.toString()) and new URL(window.location.toString())", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function shareUrl() {
        return [new URL(location.toString()), new URL(window.location.toString())];
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL(String(window.location))", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function snapshotUrl() {
        return new URL(String(window.location));
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL(location) and new URL(document.location.href)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function snapshot() {
        return [new URL(location), new URL(document.location.href)];
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a location.href-derived expression like the pre-'?' split prefix", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function reportLink() {
        return new URL(\`\${location.href.split("?")[0]}#reports\`);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a URL.canParse early-return guard before new URL", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function LinkPreview({ href }) {
        if (!URL.canParse(href)) return null;
        return new URL(href).hostname;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL of a route value pre-validated with URL.canParse", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Redirect(searchParams) {
        const target = searchParams.get("next");
        if (!URL.canParse(target)) return null;
        return new URL(target).hostname;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for chroma guarded by the documented chroma.valid ternary", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Swatch({ color }) {
        return chroma.valid(color) ? chroma(color).hex() : "#000";
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for tinycolor, which never throws and documents isValid()", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `import tinycolor from "tinycolor2";
      function Swatch({ color }) {
        const parsed = tinycolor(color);
        return parsed.isValid() ? parsed.toHexString() : "#000";
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a template literal with a hardcoded absolute origin prefix", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function repoUrl(owner, repo) {
        return new URL(\`https://github.com/\${owner}/\${repo}\`);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for the Next.js metadataBase imported-config idiom", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `import { config } from "./config";
      export const metadata = { metadataBase: new URL(config.url) };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a this-rooted class config field like this.baseUrl", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `class ApiClient {
        connect() {
          return new URL(this.baseUrl);
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a validated app-config URL read off props in render", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function ServerBadge(props) {
        const host = new URL(props.server.http.url).host;
        return host;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a websocket URL builder templating validated config members", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function terminalWebsocketUrl(input) {
        return new URL(\`\${input.url}/pty/\${input.id}/connect\`);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for vendored files under vendor/", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function track(params) {
        return new URL(params.target);
      }`,
      { filename: "vendor/analytics.js" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on new URL(request.nextUrl) in Next.js middleware (postiz shape)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `export const proxy = (request) => {
         const nextUrl = request.nextUrl;
         const target = new URL(nextUrl);
         return target.search;
       };`,
      { filename: "src/proxy.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a location.origin-prefixed template (nocobase shape)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const FilePreview = ({ file }) => {
         const absoluteUrl = /^https?:/.test(file.url)
           ? file.url
           : \`\${location.origin}/\${file.url.replace(/^\\//, "")}\`;
         const parsed = new URL(absoluteUrl);
         return <a href={parsed.href}>{file.name}</a>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not taint a helper's return value through its call arguments (AFFiNE shape)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `async function connect(client, params) {
         const discoveryUrl = await resolveDiscoveryUrl(client, params.serverId);
         const base = new URL(discoveryUrl);
         return base.host;
       }`,
      { filename: "src/providers/caldav.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags new URL over a query-param accessor chain", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const Redirect = () => {
         const target = new URL(searchParams.get("returnTo"));
         return <a href={target.href}>Continue</a>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a template whose origin position holds an untrusted value", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const Redirect = () => {
         const target = new URL(\`\${params.origin}/\${params.path}\`);
         return <a href={target.href}>Continue</a>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a config-host template whose query part is a search-params serialization (r34 shape)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `class R34Client {
        getFullUrl(path, params) {
          const host = this.backends[this.currentBackend];
          const version = this.version;
          const search = createSearchParams(params).toString();
          return new URL(\`\${host}/\${version}/\${path}?\${search}\`);
        }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for decodeURIComponent of a URLSearchParams toString chain (gatsby static-query-mapper shape)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const removeExportQueryParam = (path) => {
        const [filePath, queryParams] = path.split("?");
        const params = new URLSearchParams(queryParams.replace(/[+]/g, "%2B"));
        params.delete("export");
        const paramsString = params.toString().replace(/[+]/g, "%20");
        return \`\${filePath}\${paramsString ? \`?\${decodeURIComponent(paramsString)}\` : ""}\`;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in Storybook stories files (easy-ui shape)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function $window() {
        return window.top || window;
      }
      function tab() {
        const url = new URL($window().location.href);
        return url.searchParams.get("ezui-tab-nav-tab");
      }`,
      { filename: "src/TabNav/TabNav.stories.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a color parse in a docs demo component (suomifi shape)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `export const baseStyles = ({ color: colorProp, theme }) => {
        const color = colorProp ? colorProp : theme.colors.blackBase;
        return css\`color: \${readableColor(color)};\`;
      };`,
      { filename: "src/docs/Colors/Colors.baseStyles.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags proxy callbacks whose sibling equality check does not control their execution", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `export function partytownProxy(partytownProxiedURLs) {
        return proxy((req) => new URL(req.query.url).origin, {
          filter: (req) => partytownProxiedURLs.some((url) => req.query?.url === url),
          proxyReqPathResolver: (req) => {
            const { pathname = "", search = "" } = new URL(req.query?.url);
            return pathname + search;
          },
        });
      }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not treat a local encoded params object as route input solely because of its name", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function decodeFixedPath(value) {
        const params = { path: encodeURIComponent(value) };
        return decodeURIComponent(params.path);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a theme-named parameter because it may contain a CSS custom property", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Badge(theme) { return chroma(theme.colorPrimary).hex(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags new URL of a client-controlled referer header (webstudio shape)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `export const loader = async ({ request }) => {
        const url = new URL(request.url);
        const refererRawUrl = request.headers.get("referer");
        const refererUrl = refererRawUrl === null ? url : new URL(refererRawUrl);
        return refererUrl.host === url.host;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags decodeURI of req.path in a request handler (gatsby dev-ssr shape)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `app.get("*", async (req, res) => {
        const pagePath = store.getState().pages.get(decodeURI(req.path));
        return pagePath;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags decodeURIComponent of window.location.hash (reactuse useHash shape)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const getHash = () => decodeURIComponent(window.location.hash.replace("#", ""));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust URL.canParse with a base for a single-argument URL constructor", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function LinkPreview(searchParams) {
        const target = searchParams.get("href");
        if (!URL.canParse(target, "https://example.com")) return null;
        return new URL(target).hostname;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("respects boolean-comparison polarity around URL.canParse", () => {
    const safeResult = runRule(
      noUnguardedThrowingParseCall,
      `function LinkPreview(searchParams) {
        const target = searchParams.get("href");
        if (URL.canParse(target) === false) return null;
        return new URL(target).hostname;
      }`,
    );
    const unsafeResult = runRule(
      noUnguardedThrowingParseCall,
      `function LinkPreview(searchParams) {
        const target = searchParams.get("href");
        if (URL.canParse(target) === true) return null;
        return new URL(target).hostname;
      }`,
    );
    expect(safeResult.diagnostics).toHaveLength(0);
    expect(unsafeResult.diagnostics).toHaveLength(1);
  });

  it("invalidates URL.canParse after reassignment", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function LinkPreview(searchParams) {
        let target = searchParams.get("href");
        if (!URL.canParse(target)) return null;
        target = searchParams.get("fallback");
        return new URL(target).hostname;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a deferred reassignment invalidate URL.canParse", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function LinkPreview(searchParams) {
        let target = searchParams.get("href");
        if (!URL.canParse(target)) return null;
        queueMicrotask(() => { target = searchParams.get("fallback"); });
        return new URL(target).hostname;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps Array.from mapper callbacks protected by an outer try", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `try { Array.from(values, () => decodeURIComponent(location.hash)); } catch { recover(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let an outer try suppress a custom async-map callback", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `try { asyncMap(values, () => decodeURIComponent(location.hash)); } catch { recover(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
