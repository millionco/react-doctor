import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { repositorySecretFile } from "./repository-secret-file.js";

describe("security-scan/repository-secret-file — regressions", () => {
  it("stays silent on env example files with environment suffixes", () => {
    for (const relativePath of [
      ".env.template",
      ".env.sample",
      ".env.production.template",
      ".env.local.example",
      "projects/app/.env.staging.template",
    ]) {
      const findings = runScanRule(repositorySecretFile, {
        relativePath,
        content: `MONGODB_URI="mongodb://myusername:mypassword@localhost:27017/app"\n`,
      });
      expect(findings).toHaveLength(0);
    }
  });

  it("stays silent on placeholder connection-string credentials in dev env files", () => {
    const findings = runScanRule(repositorySecretFile, {
      relativePath: ".env.development",
      content: `DATABASE_URL=postgres://user:pass@127.0.0.1:5432/outline\nREDIS_URL=redis://127.0.0.1:6379\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on same-word default credentials", () => {
    const findings = runScanRule(repositorySecretFile, {
      relativePath: ".env",
      content: `DATABASE_URL=postgres://postgres:postgres@localhost:5433/oasst_web\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags realistic connection-string credentials", () => {
    const findings = runScanRule(repositorySecretFile, {
      relativePath: ".env",
      content: `DATABASE_URL=postgres://app_prod:N7v!q2mXfA9z@db.internal.example.com:5432/app\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags environment-specific secret files", () => {
    const findings = runScanRule(repositorySecretFile, {
      relativePath: ".env.production",
      content: `DATABASE_URL=postgres://app_prod:N7v!q2mXfA9z@db.internal.example.com:5432/app\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("handles pathological multi-dot env filenames without ambiguous suffix parsing", () => {
    const findings = runScanRule(repositorySecretFile, {
      relativePath:
        ".env.segment.segment.segment.segment.segment.segment.segment.segment.segment.segment.template",
      content: `DATABASE_URL=postgres://app_prod:N7v!q2mXfA9z@db.internal.example.com:5432/app\n`,
    });
    expect(findings).toEqual([]);
  });
});
