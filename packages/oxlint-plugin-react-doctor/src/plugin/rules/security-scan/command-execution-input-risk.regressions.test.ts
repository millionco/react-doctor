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

  it("stays silent on spawn with a fixed command and request input in the argv array (no shell)", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/server/git.ts",
      content: `spawn("git", ["log", req.query.branch]);\nspawnSync("ls", ["-la", req.query.dir]);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags spawn when the command itself is request input", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/server/run.ts",
      content: `spawn(req.query.cmd, args);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags spawn when a shell is explicitly enabled with request input in the call", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/server/run.ts",
      content: `spawn("sh", ["-c", command], { shell: true, env: req.body });\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags spawn of a shell binary running request input via -c", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/server/run.ts",
      content: `spawn("sh", ["-c", req.query.cmd]);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags spawnSync of a shell binary running request input via -c", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/server/run.ts",
      content: `spawnSync("bash", ["-c", req.body.script]);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on a shell binary running a static -c command", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/server/tasks.ts",
      content: `spawn("sh", ["-c", "git status"]);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on zero-taint spawn with { shell: true } and a static argv", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/server/tasks.ts",
      content: `spawn("ls", ["-la"], { shell: true });\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on zero-taint exec with { shell: true }", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/server/tasks.ts",
      content: `execSync("git status", { shell: true });\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags spawn of a template-literal tainted command", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/server/run.ts",
      content: "spawn(`${req.query.cmd}`);\n",
    });
    expect(findings).toHaveLength(1);
  });

  it("flags spawn of a concatenated tainted command with { shell: true }", () => {
    const findings = runScanRule(commandExecutionInputRisk, {
      relativePath: "src/server/run.ts",
      content: `spawn("tar -xf " + req.query.file, { shell: true });\n`,
    });
    expect(findings).toHaveLength(1);
  });
});
