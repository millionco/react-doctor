import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { pluginUpdateTrustRisk } from "./plugin-update-trust-risk.js";

describe("security-scan/plugin-update-trust-risk — regressions", () => {
  it("stays silent on a plain download link near an https URL", () => {
    const findings = runScanRule(pluginUpdateTrustRisk, {
      relativePath: "src/components/download-button.tsx",
      content: `const downloadHref = "https://example.com/exports/report.csv";\nexport const DownloadButton = () => <a href={downloadHref}>Download</a>;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags an updater downloading and unpacking an executable artifact", () => {
    const findings = runScanRule(pluginUpdateTrustRisk, {
      relativePath: "src/updater.ts",
      content: `import { spawnSync } from "node:child_process";\nconst updateUrl = await fetchLatestRelease();\nawait downloadFile(updateUrl, "/tmp/update.zip");\nspawnSync("unzip", ["/tmp/update.zip"]);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on install instructions only displayed in UI copy", () => {
    const findings = runScanRule(pluginUpdateTrustRisk, {
      relativePath: "src/onboarding/install-step.tsx",
      content: `export const InstallStep = () => (\n  <CodeSnippet>{"curl --proto '=https' -LsSf https://example.com/cli-installer.sh | sh"}</CodeSnippet>\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on install-command constants that are never executed", () => {
    const findings = runScanRule(pluginUpdateTrustRisk, {
      relativePath: "src/types/agent.ts",
      content: `export const CLI_INSTALL_COMMANDS = [\n  "curl -fsSL https://claude.ai/install.sh | bash",\n  "brew install --cask claude-code",\n] as const;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on curl uploads of build artifacts (postiz extension shape)", () => {
    const findings = runScanRule(pluginUpdateTrustRisk, {
      relativePath: ".github/workflows/build-extension.yaml",
      content: `      - name: Upload artifact\n        run: |\n          curl -T apps/extension/extension.zip \\\n            https://artifacts.example.com/upload\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on checksum-verified downloads (infisical oracle-client shape)", () => {
    const findings = runScanRule(pluginUpdateTrustRisk, {
      relativePath: "backend/Dockerfile",
      content: `RUN ORACLE_ZIP="instantclient-basic-linux.x64-23.26.0.0.0.zip" && \\\n    EXPECTED_SHA="d6c79cbcf0ff209363e779855c690d4fc730aed847e9198a2c439bcf34760af5" && \\\n    wget -q "https://download.oracle.com/otn_software/\${ORACLE_ZIP}" && \\\n    echo "\${EXPECTED_SHA} \${ORACLE_ZIP}" | sha256sum -c -\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on healthcheck wget near unrelated chmod (outline Dockerfile shape)", () => {
    const findings = runScanRule(pluginUpdateTrustRisk, {
      relativePath: "Dockerfile",
      content: `RUN apt-get update \\\n    && apt-get install -y wget \\\n    && rm -rf /var/lib/apt/lists/*\nRUN mkdir -p "/var/lib/outline/data" && chmod 1777 "/var/lib/outline/data"\nHEALTHCHECK --interval=1m CMD wget -qO- "http://localhost:3000/_health" | grep -q "OK" || exit 1\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
