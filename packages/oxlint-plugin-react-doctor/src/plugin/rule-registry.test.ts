import { describe, expect, it } from "vite-plus/test";
import plugin from "./react-doctor-plugin.js";
import { ruleRegistry } from "./rule-registry.js";
import { parseSourceText } from "./utils/parse-source-file.js";
import { walkAst } from "./utils/walk-ast.js";

const REANIMATED_LAYOUT_RULE_ID = "rn-animate-layout-property";
const CASCADING_SET_STATE_RULE_ID = "no-cascading-set-state";

// The full security-scan bucket: project-level scan rules executed by
// @react-doctor/core's check-security-scan environment check instead of
// the oxlint AST pipeline. Inlined so an accidental bucket addition/removal
// fails loudly here instead of silently shifting scan coverage.
const SECURITY_POSTURE_RULE_IDS = [
  "active-static-asset",
  "agent-tool-capability-risk",
  "artifact-baas-authority-surface",
  "artifact-env-leak",
  "artifact-secret-leak",
  "build-pipeline-secret-boundary",
  "clickjacking-redirect-risk",
  "command-execution-input-risk",
  "cors-cookie-trust-risk",
  "dangerous-html-sink",
  "firebase-client-owned-authz-field",
  "firebase-permissive-rules",
  "firebase-query-filter-as-auth",
  "git-provider-url-injection-risk",
  "import-metadata-execution-risk",
  "insecure-crypto-risk",
  "insecure-session-cookie",
  "jwt-insecure-verification",
  "key-lifecycle-risk",
  "local-rpc-native-bridge-risk",
  "mcp-tool-capability-risk",
  "mdx-ssr-execution-risk",
  "nosql-injection-risk",
  "package-metadata-secret",
  "path-traversal-risk",
  "plugin-update-trust-risk",
  "postmessage-origin-risk",
  "public-debug-artifact",
  "public-env-secret-name",
  "raw-sql-injection-risk",
  "repository-secret-file",
  "request-body-mass-assignment",
  "secret-in-fallback",
  "supabase-client-owned-authz-field",
  "supabase-rls-policy-risk",
  "supabase-table-missing-rls",
  "svg-filter-clickjacking-risk",
  "tenant-static-proxy-risk",
  "unsafe-json-in-html",
  "untrusted-redirect-following",
  "url-prefilled-privileged-action",
  "webhook-signature-risk",
] as const;

describe("rule registry", () => {
  it("keeps the Reanimated layout-property rule retired", () => {
    expect(ruleRegistry[REANIMATED_LAYOUT_RULE_ID]?.lifecycle).toBe("retired");
    expect(ruleRegistry[REANIMATED_LAYOUT_RULE_ID]?.defaultEnabled).toBe(false);
  });

  it("keeps the cascading setState rule retired", () => {
    expect(ruleRegistry[CASCADING_SET_STATE_RULE_ID]?.lifecycle).toBe("retired");
    expect(ruleRegistry[CASCADING_SET_STATE_RULE_ID]?.defaultEnabled).toBe(false);
  });

  it("registers exactly the 42 known security-scan rules", () => {
    const taggedIds = Object.entries(ruleRegistry)
      .filter(([, rule]) => (rule.tags ?? []).includes("security-scan"))
      .map(([ruleId]) => ruleId)
      .sort();
    expect(taggedIds).toHaveLength(42);
    expect(taggedIds).toEqual([...SECURITY_POSTURE_RULE_IDS]);
  });

  it("gives every security-scan rule a scan function and no other rule a scan field", () => {
    for (const [ruleId, rule] of Object.entries(ruleRegistry)) {
      if ((rule.tags ?? []).includes("security-scan")) {
        expect(typeof rule.scan, `${ruleId} should carry a scan`).toBe("function");
      } else {
        expect(rule.scan, `${ruleId} should not carry a scan`).toBeUndefined();
      }
    }
  });

  it("wraps rules for host context compatibility", () => {
    for (const [ruleId, rule] of Object.entries(ruleRegistry)) {
      const hostRule = plugin.rules[ruleId];
      expect(hostRule, `${ruleId} should be registered`).toBeDefined();
      expect(hostRule?.create, `${ruleId} host context wrapper`).not.toBe(rule.create);
    }
  });

  // Regression: rules can consume `context.scopes` through shared helpers
  // and factories (`createDeprecatedReactImportRule` resolves namespace
  // aliases via `resolveConstIdentifierAlias`), where no static marker in
  // the rule's own file reveals the dependency. The host wrapper must
  // capture the Program root for every rule so those reads see live scope
  // analysis instead of the conservative stubs.
  it("serves live scope analysis to rules that read it through shared helpers", () => {
    const hostRule = plugin.rules["no-react-dom-deprecated-apis"];
    const program = parseSourceText({
      filename: "/tmp/deprecated-render.tsx",
      sourceText: `import ReactDOM from "react-dom";
        export const mount = (element, container) => ReactDOM.render(element, container);`,
    });
    if (!hostRule || program === null) throw new Error("Expected rule and parsed fixture");

    const reportedMessages: string[] = [];
    const visitors = hostRule.create({
      report: (descriptor) => {
        reportedMessages.push(descriptor.message);
      },
      filename: "/tmp/deprecated-render.tsx",
    });
    walkAst(program, (node) => {
      visitors[node.type]?.(node);
    });

    expect(reportedMessages.some((message) => message.includes("createRoot"))).toBe(true);
  });
});
