import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { tenantStaticProxyRisk } from "./tenant-static-proxy-risk.js";

describe("security-scan/tenant-static-proxy-risk — regressions", () => {
  it("stays silent on OAuth callbacks that build a params object near a token fetch", () => {
    const findings = runScanRule(tenantStaticProxyRisk, {
      relativePath: "packages/app-store/zohocalendar/api/callback.ts",
      content: `const params = {\n  client_id,\n  grant_type: "authorization_code",\n  client_secret,\n  redirect_uri: \`\${WEBAPP_URL}/api/integrations/\${config.slug}/callback\`,\n  code,\n};\nconst tokenResponse = await fetch(\`https://accounts.zoho.com/oauth/v2/token?\${stringify(params)}\`);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on route handlers that pass request params to an API call", () => {
    const findings = runScanRule(tenantStaticProxyRisk, {
      relativePath: "app/api/users/route.ts",
      content: `export async function GET(request, { params }) {\n  const response = await fetch("/api/users", { method: "POST", body: JSON.stringify(params) });\n  return response;\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags asset fetches whose path interpolates a tenant identifier", () => {
    const findings = runScanRule(tenantStaticProxyRisk, {
      relativePath: "app/api/static/route.ts",
      content:
        "export const GET = async (request) => fetch(`${CDN_BASE}/${tenant}/${assetPath}`);\n",
    });
    expect(findings).toHaveLength(1);
  });

  it("flags asset path joins built from tenant input", () => {
    const findings = runScanRule(tenantStaticProxyRisk, {
      relativePath: "server/routes/assets.ts",
      content: `export const resolveAssetPath = (subdomain, assetName) =>\n  path.join(STATIC_ROOT, subdomain, assetName);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on local path joins of workspace-prefixed data (insomnia shape)", () => {
    const findings = runScanRule(tenantStaticProxyRisk, {
      relativePath: "src/routes/import.ts",
      content: `const fullPath = window.path.join(workspaceData.folderPath, workspaceData.fileName);\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
