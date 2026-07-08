import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { isServerRouteSourcePath } from "./utils/is-server-route-source-path.js";

// `(?<![.\w$])fetch` keeps method fetches (Durable Object stubs, service
// bindings, `this.fetch`) out — those are same-application proxies.
const OUTBOUND_FETCH_CALL_PATTERN =
  /(?:(?<![.\w$])fetch|\baxios\.\s*(?:get|post|put|delete|head)|\bgot|\bgot\.\s*(?:get|post))\s*\(\s*([^,)]+)/;

const CALLER_STYLE_URL_NAME_PATTERN =
  /\b(?:url|targetUrl|callbackUrl|redirectUrl|webhookUrl|companyUrl|websiteUrl|domainUrl|imageUrl|fetchUrl|next|return_to|returnTo|destination|location)\b/i;

const REQUEST_INPUT_EXPRESSION_PATTERN =
  /\breq\.|\brequest\.(?:query|body|params|nextUrl)|\bsearchParams\b|\bparams\.|\bbody\.|\bquery\./;

const SAFE_REDIRECT_MODE_PATTERN = /\bredirect\s*:\s*["'](?:manual|error)["']/;

// `params`/`body`/`query` are request-sourced only as ambient route-handler
// bindings. When the same file constructs the variable itself
// (`const params = new URLSearchParams()` feeding
// `const url = \`\${apiRoot}?\${params.toString()}\``), it is local data,
// not caller input.
const AMBIENT_REQUEST_TOKEN_PATTERN = /\b(params|body|query)\./g;

const isLocallyConstructedBinding = (bindingName: string, fileContent: string): boolean => {
  const localConstructionPattern = new RegExp(
    `(?:const|let|var)\\s+${bindingName}\\s*(?::[^=;\\n]{0,80})?=\\s*new\\s+URLSearchParams\\b`,
  );
  return localConstructionPattern.test(fileContent);
};

const hasRequestSourcedToken = (expression: string, fileContent: string): boolean => {
  const withoutAmbientTokens = expression.replace(
    AMBIENT_REQUEST_TOKEN_PATTERN,
    (ambientToken, bindingName: string) =>
      isLocallyConstructedBinding(bindingName, fileContent) ? "" : ambientToken,
  );
  return REQUEST_INPUT_EXPRESSION_PATTERN.test(withoutAmbientTokens);
};

// A variable merely NAMED `url` is not caller input; the URL expression (or
// the same-file assignment that produced it) must read from the request.
const isRequestSourcedUrlExpression = (urlExpression: string, fileContent: string): boolean => {
  if (hasRequestSourcedToken(urlExpression, fileContent)) return true;
  const identifierMatch = /^[\w$]+$/.exec(urlExpression.trim());
  if (identifierMatch === null) return false;
  // `[^=;\n]{0,80}` on both sides of the name covers plain declarations and
  // destructuring (`const { imageUrl } = await request.json()`).
  const assignmentPattern = new RegExp(
    `(?:const|let|var)[^=;\\n]{0,80}\\b${identifierMatch[0]}\\b[^=;\\n]{0,80}=([^;\\n]*)`,
    "g",
  );
  for (const assignmentMatch of fileContent.matchAll(assignmentPattern)) {
    const initializer = assignmentMatch[1] ?? "";
    if (/\breq\.|\brequest\.|\bsearchParams\b|\$_(?:GET|POST|REQUEST)/.test(initializer))
      return true;
    if (hasRequestSourcedToken(initializer, fileContent)) return true;
  }
  return false;
};

export const untrustedRedirectFollowing = defineRule({
  id: "untrusted-redirect-following",
  title: "Server fetch follows redirects for caller-shaped URL",
  severity: "warn",
  recommendation:
    'Use `redirect: "manual"` or equivalent and re-validate every redirect target before following it to avoid SSRF redirect bypasses.',
  scan: (file) => {
    if (!isServerRouteSourcePath(file.relativePath)) return [];
    if (!OUTBOUND_FETCH_CALL_PATTERN.test(file.content)) return [];

    const findings: ScanFinding[] = [];
    const lines = file.content.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      const fetchMatch = line.match(OUTBOUND_FETCH_CALL_PATTERN);
      const urlExpression = fetchMatch?.[1] ?? "";
      if (!fetchMatch || !CALLER_STYLE_URL_NAME_PATTERN.test(urlExpression)) continue;
      if (!isRequestSourcedUrlExpression(urlExpression, file.content)) continue;

      const fetchWindow = lines.slice(lineIndex, lineIndex + 5).join("\n");
      if (SAFE_REDIRECT_MODE_PATTERN.test(fetchWindow)) continue;

      findings.push({
        message:
          "Server-side fetch code appears to follow redirects for a URL shaped like caller-controlled input.",
        line: lineIndex + 1,
        column: line.search(/\S/) + 1,
      });
    }
    return findings;
  },
});
