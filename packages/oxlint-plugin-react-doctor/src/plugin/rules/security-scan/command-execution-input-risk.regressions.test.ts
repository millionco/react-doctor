import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { commandExecutionInputRisk } from "./command-execution-input-risk.js";

describe("security-scan/command-execution-input-risk — regressions", () => {
  it("stays silent on .exec() method calls (tldraw store.query.exec shape)", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/lib/store-queries.ts",
      content: `const currentInStockBooks = store.query.exec("book", { inStock: { eq: true } });\nconst match = pattern.exec(request.body.title);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent in python test files", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "backend/services/test_docker_sandbox.py",
      content: `result = subprocess.run(["docker", "images", "-q", f"snapshot:{snapshot_id}"], capture_output=True)\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags shell execution of request input", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/server/convert.ts",
      content: `import { exec } from "node:child_process";\n\napp.post("/convert", (req, res) => {\n  exec("convert " + req.body.filename, handleResult);\n});\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent when logging f-strings follow a static subprocess call", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "backend/services/docker_sandbox.py",
      content: `def _run(args, check=False, timeout=None):\n    result = subprocess.run(args, capture_output=True, text=True, check=check, timeout=timeout)\n    if result.stdout:\n        logger.debug(f"stdout: {result.stdout[:500]}")\n    return result\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags f-string interpolation inside the subprocess call itself", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "backend/report.py",
      content: `import os\ndef run(request):\n    os.system(f"wkhtmltopdf {request.args['url']} /tmp/report.pdf")\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent in repo tooling fed by argv (sentry bump_version shape)", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "tools/bump_version.py",
      content: `def main(args):\n    return subprocess.call(("uv", "add", "--dev", f"{args.package}>={args.version}"))\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent in django management commands", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "backend/management/commands/seed_dummy_runs.py",
      content: `def seed(shell=True):\n    result = subprocess.run(f"createdb {options['name']}", shell=True)\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
