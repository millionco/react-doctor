// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { activeStaticAsset } from "./rules/security-scan/active-static-asset.js";
import { agentToolCapabilityRisk } from "./rules/security-scan/agent-tool-capability-risk.js";
import { artifactBaasAuthoritySurface } from "./rules/security-scan/artifact-baas-authority-surface.js";
import { artifactEnvLeak } from "./rules/security-scan/artifact-env-leak.js";
import { artifactSecretLeak } from "./rules/security-scan/artifact-secret-leak.js";
import { buildPipelineSecretBoundary } from "./rules/security-scan/build-pipeline-secret-boundary.js";
import { clickjackingRedirectRisk } from "./rules/security-scan/clickjacking-redirect-risk.js";
import { commandExecutionInputRisk } from "./rules/security-scan/command-execution-input-risk.js";
import { corsCookieTrustRisk } from "./rules/security-scan/cors-cookie-trust-risk.js";
import { dangerousHtmlSink } from "./rules/security-scan/dangerous-html-sink.js";
import { firebaseClientOwnedAuthzField } from "./rules/security-scan/firebase-client-owned-authz-field.js";
import { firebasePermissiveRules } from "./rules/security-scan/firebase-permissive-rules.js";
import { firebaseQueryFilterAsAuth } from "./rules/security-scan/firebase-query-filter-as-auth.js";
import { gitProviderUrlInjectionRisk } from "./rules/security-scan/git-provider-url-injection-risk.js";
import { importMetadataExecutionRisk } from "./rules/security-scan/import-metadata-execution-risk.js";
import { insecureCryptoRisk } from "./rules/security-scan/insecure-crypto-risk.js";
import { insecureSessionCookie } from "./rules/security-scan/insecure-session-cookie.js";
import { jwtInsecureVerification } from "./rules/security-scan/jwt-insecure-verification.js";
import { keyLifecycleRisk } from "./rules/security-scan/key-lifecycle-risk.js";
import { localRpcNativeBridgeRisk } from "./rules/security-scan/local-rpc-native-bridge-risk.js";
import { mcpToolCapabilityRisk } from "./rules/security-scan/mcp-tool-capability-risk.js";
import { mdxSsrExecutionRisk } from "./rules/security-scan/mdx-ssr-execution-risk.js";
import { nosqlInjectionRisk } from "./rules/security-scan/nosql-injection-risk.js";
import { packageMetadataSecret } from "./rules/security-scan/package-metadata-secret.js";
import { pathTraversalRisk } from "./rules/security-scan/path-traversal-risk.js";
import { pluginUpdateTrustRisk } from "./rules/security-scan/plugin-update-trust-risk.js";
import { postmessageOriginRisk } from "./rules/security-scan/postmessage-origin-risk.js";
import { publicDebugArtifact } from "./rules/security-scan/public-debug-artifact.js";
import { publicEnvSecretName } from "./rules/security-scan/public-env-secret-name.js";
import { rawSqlInjectionRisk } from "./rules/security-scan/raw-sql-injection-risk.js";
import { repositorySecretFile } from "./rules/security-scan/repository-secret-file.js";
import { requestBodyMassAssignment } from "./rules/security-scan/request-body-mass-assignment.js";
import { secretInFallback } from "./rules/security-scan/secret-in-fallback.js";
import { supabaseClientOwnedAuthzField } from "./rules/security-scan/supabase-client-owned-authz-field.js";
import { supabaseRlsPolicyRisk } from "./rules/security-scan/supabase-rls-policy-risk.js";
import { supabaseTableMissingRls } from "./rules/security-scan/supabase-table-missing-rls.js";
import { svgFilterClickjackingRisk } from "./rules/security-scan/svg-filter-clickjacking-risk.js";
import { tenantStaticProxyRisk } from "./rules/security-scan/tenant-static-proxy-risk.js";
import { unsafeJsonInHtml } from "./rules/security-scan/unsafe-json-in-html.js";
import { untrustedRedirectFollowing } from "./rules/security-scan/untrusted-redirect-following.js";
import { urlPrefilledPrivilegedAction } from "./rules/security-scan/url-prefilled-privileged-action.js";
import { webhookSignatureRisk } from "./rules/security-scan/webhook-signature-risk.js";

export const reactDoctorScanRules = [
  {
    key: "react-doctor/active-static-asset",
    id: "active-static-asset",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...activeStaticAsset,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(activeStaticAsset.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/agent-tool-capability-risk",
    id: "agent-tool-capability-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...agentToolCapabilityRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(agentToolCapabilityRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/artifact-baas-authority-surface",
    id: "artifact-baas-authority-surface",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...artifactBaasAuthoritySurface,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(artifactBaasAuthoritySurface.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/artifact-env-leak",
    id: "artifact-env-leak",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...artifactEnvLeak,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(artifactEnvLeak.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/artifact-secret-leak",
    id: "artifact-secret-leak",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...artifactSecretLeak,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(artifactSecretLeak.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/build-pipeline-secret-boundary",
    id: "build-pipeline-secret-boundary",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...buildPipelineSecretBoundary,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(buildPipelineSecretBoundary.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/clickjacking-redirect-risk",
    id: "clickjacking-redirect-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...clickjackingRedirectRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(clickjackingRedirectRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/command-execution-input-risk",
    id: "command-execution-input-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...commandExecutionInputRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(commandExecutionInputRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/cors-cookie-trust-risk",
    id: "cors-cookie-trust-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...corsCookieTrustRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(corsCookieTrustRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/dangerous-html-sink",
    id: "dangerous-html-sink",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...dangerousHtmlSink,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(dangerousHtmlSink.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/firebase-client-owned-authz-field",
    id: "firebase-client-owned-authz-field",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...firebaseClientOwnedAuthzField,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(firebaseClientOwnedAuthzField.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/firebase-permissive-rules",
    id: "firebase-permissive-rules",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...firebasePermissiveRules,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(firebasePermissiveRules.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/firebase-query-filter-as-auth",
    id: "firebase-query-filter-as-auth",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...firebaseQueryFilterAsAuth,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(firebaseQueryFilterAsAuth.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/git-provider-url-injection-risk",
    id: "git-provider-url-injection-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...gitProviderUrlInjectionRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(gitProviderUrlInjectionRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/import-metadata-execution-risk",
    id: "import-metadata-execution-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...importMetadataExecutionRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(importMetadataExecutionRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/insecure-crypto-risk",
    id: "insecure-crypto-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...insecureCryptoRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(insecureCryptoRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/insecure-session-cookie",
    id: "insecure-session-cookie",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...insecureSessionCookie,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(insecureSessionCookie.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/jwt-insecure-verification",
    id: "jwt-insecure-verification",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...jwtInsecureVerification,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(jwtInsecureVerification.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/key-lifecycle-risk",
    id: "key-lifecycle-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...keyLifecycleRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(keyLifecycleRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/local-rpc-native-bridge-risk",
    id: "local-rpc-native-bridge-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...localRpcNativeBridgeRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(localRpcNativeBridgeRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/mcp-tool-capability-risk",
    id: "mcp-tool-capability-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...mcpToolCapabilityRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(mcpToolCapabilityRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/mdx-ssr-execution-risk",
    id: "mdx-ssr-execution-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...mdxSsrExecutionRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(mdxSsrExecutionRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/nosql-injection-risk",
    id: "nosql-injection-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nosqlInjectionRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(nosqlInjectionRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/package-metadata-secret",
    id: "package-metadata-secret",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...packageMetadataSecret,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(packageMetadataSecret.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/path-traversal-risk",
    id: "path-traversal-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...pathTraversalRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(pathTraversalRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/plugin-update-trust-risk",
    id: "plugin-update-trust-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...pluginUpdateTrustRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(pluginUpdateTrustRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/postmessage-origin-risk",
    id: "postmessage-origin-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...postmessageOriginRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(postmessageOriginRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/public-debug-artifact",
    id: "public-debug-artifact",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...publicDebugArtifact,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(publicDebugArtifact.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/public-env-secret-name",
    id: "public-env-secret-name",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...publicEnvSecretName,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(publicEnvSecretName.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/raw-sql-injection-risk",
    id: "raw-sql-injection-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rawSqlInjectionRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(rawSqlInjectionRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/repository-secret-file",
    id: "repository-secret-file",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...repositorySecretFile,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(repositorySecretFile.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/request-body-mass-assignment",
    id: "request-body-mass-assignment",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...requestBodyMassAssignment,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(requestBodyMassAssignment.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/secret-in-fallback",
    id: "secret-in-fallback",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...secretInFallback,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(secretInFallback.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/supabase-client-owned-authz-field",
    id: "supabase-client-owned-authz-field",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...supabaseClientOwnedAuthzField,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(supabaseClientOwnedAuthzField.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/supabase-rls-policy-risk",
    id: "supabase-rls-policy-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...supabaseRlsPolicyRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(supabaseRlsPolicyRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/supabase-table-missing-rls",
    id: "supabase-table-missing-rls",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...supabaseTableMissingRls,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(supabaseTableMissingRls.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/svg-filter-clickjacking-risk",
    id: "svg-filter-clickjacking-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...svgFilterClickjackingRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(svgFilterClickjackingRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/tenant-static-proxy-risk",
    id: "tenant-static-proxy-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...tenantStaticProxyRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(tenantStaticProxyRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/unsafe-json-in-html",
    id: "unsafe-json-in-html",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...unsafeJsonInHtml,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(unsafeJsonInHtml.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/untrusted-redirect-following",
    id: "untrusted-redirect-following",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...untrustedRedirectFollowing,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(untrustedRedirectFollowing.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/url-prefilled-privileged-action",
    id: "url-prefilled-privileged-action",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...urlPrefilledPrivilegedAction,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(urlPrefilledPrivilegedAction.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/webhook-signature-risk",
    id: "webhook-signature-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...webhookSignatureRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(webhookSignatureRisk.tags ?? [])])],
    },
  },
] as const;
