import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { keyLifecycleRisk } from "./key-lifecycle-risk.js";

describe("security-scan/key-lifecycle-risk — regressions", () => {
  it("stays silent when CI references a key name from the secret store", () => {
    const findings = runScanRule(keyLifecycleRisk, {
      relativePath: ".github/workflows/deploy.yml",
      content: `steps:\n  - uses: webfactory/ssh-agent@v0.9.0\n    with:\n      ssh-private-key: \${{ secrets.SSH_PRIVATE_KEY }}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on PEM placeholder templates in help text", () => {
    const findings = runScanRule(keyLifecycleRisk, {
      relativePath: "backend/management/commands/setup-agents.py",
      content: `self.stdout.write('GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\\\n...\\\\n-----END RSA PRIVATE KEY-----"')\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags PEM private key material", () => {
    const findings = runScanRule(keyLifecycleRisk, {
      relativePath: "config/deploy.pem",
      content: `-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7c1QpDK0N77BSO0FbGCPzcgMCS8ssCXd2eicCRb45fJsbiCe\nahGd0WOZHCSpwHcwgvT5ml0zXmkSO0Iqcm8m3aIp7DJBkLAA1MuYjvVLPyEDqGtR\n-----END RSA PRIVATE KEY-----\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags a key name assigned an inline literal", () => {
    const findings = runScanRule(keyLifecycleRisk, {
      relativePath: "src/config.ts",
      content: `const DEPLOY_KEY = "9f8e7d6c5b4a39281706f5e4d3c2b1a0";\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on PEM placeholders truncated with an ellipsis", () => {
    const findings = runScanRule(keyLifecycleRisk, {
      relativePath: "docs/configuration.md",
      content: `JWT_SECRET_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END RSA PRIVATE KEY-----"\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on PEM headers in input placeholders (grafana TLS form shape)", () => {
    const findings = runScanRule(keyLifecycleRisk, {
      relativePath: "src/components/TLSSecretsConfig.tsx",
      content: `<TextArea placeholder="-----BEGIN RSA PRIVATE KEY-----" rows={7} onChange={onKeyChange} />\nconst privateKeyBeginsWith = '-----BEGIN RSA PRIVATE KEY-----';\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on PEM headers wrapped around interpolated key variables", () => {
    const findings = runScanRule(keyLifecycleRisk, {
      relativePath: "src/services/chef-connection-fns.ts",
      content:
        "formattedKey = `-----BEGIN RSA PRIVATE KEY-----\\n${formattedKey}\\n-----END RSA PRIVATE KEY-----`;\n",
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on throwaway keys bound to placeholder constants (insomnia shape)", () => {
    const findings = runScanRule(keyLifecycleRisk, {
      relativePath: "src/components/auth-private-key-row.tsx",
      content: `const PRIVATE_KEY_PLACEHOLDER = \`\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpQIBAAKCAQEA39k9udklHnmkU0GtTLpnYtKk1l5txYmUD/cGI0bFd3HHOOLG\nmI0av55vMFEhxL7yrFrcL8pRKp0+pnOVStMDmbwsPE/pu9pf3uxD+m9/Flv89bUk\n-----END RSA PRIVATE KEY-----\`;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on sample keys inside documentation", () => {
    const findings = runScanRule(keyLifecycleRisk, {
      relativePath: "docs/versioned_docs/version-3.5.0-LTS/data-sources/bigquery.md",
      content: `  "private_key": "-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDRGgDmfwYcKp4q\\n3ce4DkrKv0vTn"\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
