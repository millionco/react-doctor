import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { untrustedRedirectFollowing } from "./untrusted-redirect-following.js";

describe("security-scan/untrusted-redirect-following — regressions", () => {
  it("stays silent when a url variable is built from internal config", () => {
    const findings = runScanRule(untrustedRedirectFollowing, {
      relativePath: "server/routers/admin/create-coupon.ts",
      content: `const url = \`\${LICENSE_API_BASE}/v1/coupons\`;\nreturn await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on generic fetch wrappers that accept a url parameter", () => {
    const findings = runScanRule(untrustedRedirectFollowing, {
      relativePath: "src/lib/api/fetch-with-timeout.ts",
      content: `export async function fetchWithTimeout(url, init, options) {\n  const response = await fetch(url, { ...init, signal: controller.signal });\n  return response;\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on Durable Object stub fetches of the inbound request url", () => {
    const findings = runScanRule(untrustedRedirectFollowing, {
      relativePath: "worker/routes/stream.ts",
      content: `const durableObjectStub = env.AGENT_DURABLE_OBJECT.get(id);\nconst response = await durableObjectStub.fetch(request.url, { method: "POST" });\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags fetches of a url read directly from the request", () => {
    const findings = runScanRule(untrustedRedirectFollowing, {
      relativePath: "app/api/preview/route.ts",
      content: `export const GET = (request) => fetch(request.nextUrl.searchParams.get("url"));\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags fetches of a url destructured from the request body", () => {
    const findings = runScanRule(untrustedRedirectFollowing, {
      relativePath: "app/api/preview/route.ts",
      content: `export const POST = async (request) => {\n  const { imageUrl } = await request.json();\n  return fetch(imageUrl);\n};\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent when the request-sourced fetch disables redirect following", () => {
    const findings = runScanRule(untrustedRedirectFollowing, {
      relativePath: "app/api/preview/route.ts",
      content: `export const POST = async (request) => {\n  const { imageUrl } = await request.json();\n  return fetch(imageUrl, { redirect: "manual" });\n};\n`,
    });
    expect(findings).toHaveLength(0);
  });

  // Docs-validation FP wave: `params.` is request-sourced only as an ambient
  // route-handler binding; a locally constructed `new URLSearchParams()` is
  // the code's own data, not caller input.
  it("stays silent on urls built from a locally constructed URLSearchParams (jaeger client shape)", () => {
    const content = [
      "const params = new URLSearchParams();",
      "params.set('query.serviceName', query.service);",
      "const url = `${this.apiRoot}/trace-summaries?${params.toString()}`;",
      "const response = await fetch(url, { signal: controller.signal });",
    ].join("\n");
    const findings = runScanRule(untrustedRedirectFollowing, {
      relativePath: "src/api/v3/client.ts",
      content,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on locally built subsonic ping urls (psysonic fingerprint shape)", () => {
    const content = [
      "const params = new URLSearchParams({ u: username, t: token, s: salt, f: 'json' });",
      "const url = `${restBaseFromUrl(baseUrl)}/ping.view?${params.toString()}`;",
      "const resp = await fetch(url, { method: 'GET', headers });",
    ].join("\n");
    const findings = runScanRule(untrustedRedirectFollowing, {
      relativePath: "src/utils/server/server-fingerprint.ts",
      content,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags urls built from ambient route params without local construction", () => {
    const content = [
      "export const GET = async (request, { params }) => {",
      "  const url = `https://${params.host}/webhook`;",
      "  return fetch(url);",
      "};",
    ].join("\n");
    const findings = runScanRule(untrustedRedirectFollowing, {
      relativePath: "app/api/relay/route.ts",
      content,
    });
    expect(findings).toHaveLength(1);
  });
});
