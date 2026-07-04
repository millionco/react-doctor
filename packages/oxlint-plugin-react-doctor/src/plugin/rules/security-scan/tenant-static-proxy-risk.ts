import { defineRule } from "../../utils/define-rule.js";
import { isServerRouteSourcePath } from "./utils/is-server-route-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

export const tenantStaticProxyRisk = defineRule({
  id: "tenant-static-proxy-risk",
  title: "Tenant-controlled static asset proxy",
  severity: "warn",
  impact: "security",
  confidence: "heuristic",
  fix: "local",
  recommendation:
    "Bind tenant identity to the trusted host or authenticated org, canonicalize after decoding, reject traversal, and never let one tenant choose another tenant's asset prefix.",
  // `params` near `fetch` matched every dynamic route handler; the tenant
  // identifier must sit inside the asset-fetch call's own argument list.
  // `(?<!\.)org` keeps `.org` domain literals from counting.
  scan: scanByPattern({
    shouldScan: (file) => isServerRouteSourcePath(file.relativePath),
    pattern:
      /\b(?:fetch|path\.join|getObject\w*|GetObjectCommand|getSignedUrl|createReadStream)\s*\([^;]{0,200}(?:\$\{[^}]{0,100}\b(?:tenant|subdomain|workspace|hostPattern|(?<!\.)organization(?:Id|Slug)?)\b|\b(?:tenant|subdomain|workspace)(?:Id|Slug|Name)?\b\s*[,)+\].])/i,
    message:
      "Route code appears to compose tenant or subdomain input into a static/CDN/object-store fetch path.",
  }),
});
