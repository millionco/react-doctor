import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as fs from "node:fs";
import {
  detectGitHookTarget,
  installReactDoctorGitHook,
} from "../src/cli/utils/install-git-hook.js";

interface GitHookFixture {
  readonly projectRoot: string;
  readonly hookPath: string;
  readonly cleanup: () => void;
}

const setupFixture = (): GitHookFixture => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-git-hook-"));
  return {
    projectRoot: root,
    hookPath: path.join(root, ".git/hooks/pre-commit"),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

const readHook = (hookPath: string): string => fs.readFileSync(hookPath, "utf8");

const writePackageJson = (projectRoot: string, content: object): void => {
  fs.writeFileSync(path.join(projectRoot, "package.json"), `${JSON.stringify(content, null, 2)}\n`);
};

const readJsonFile = <Value>(filePath: string): Value =>
  JSON.parse(fs.readFileSync(filePath, "utf8"));

describe.skipIf(process.platform === "win32")("installReactDoctorGitHook", () => {
  let fixture: GitHookFixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("creates a dependency-free non-blocking pre-commit hook without a managed runner", () => {
    const result = installReactDoctorGitHook({
      hookPath: fixture.hookPath,
      projectRoot: fixture.projectRoot,
    });
    const hookContent = readHook(fixture.hookPath);

    expect(result.status).toBe("created");
    expect(result.kind).toBe("git");
    expect(hookContent).toContain("#!/bin/sh");
    expect(hookContent).toContain("react-doctor --staged --blocking warning");
    expect(hookContent).toContain("pnpm dlx react-doctor@latest --staged --blocking warning");
    expect(hookContent).toContain("npx --yes react-doctor@latest --staged --blocking warning");
    expect(hookContent).toContain("Want them fixed?");
    expect(hookContent).not.toContain("Stop commit");
    expect(hookContent).not.toContain(".react-doctor/hooks/pre-commit");
    expect(hookContent).not.toContain("husky");
    expect(fs.existsSync(fixture.hookPath)).toBe(true);
    expect(Boolean(fs.statSync(fixture.hookPath).mode & fs.constants.S_IXUSR)).toBe(true);
  });

  it("does not detect a Git hook target outside a Git repository", () => {
    expect(detectGitHookTarget(fixture.projectRoot)).toBe(null);
  });

  it("preserves existing hook content", () => {
    fs.mkdirSync(path.dirname(fixture.hookPath), { recursive: true });
    fs.writeFileSync(fixture.hookPath, "#!/bin/sh\nnpm test\n");

    const result = installReactDoctorGitHook({
      hookPath: fixture.hookPath,
      projectRoot: fixture.projectRoot,
    });
    const hookContent = readHook(fixture.hookPath);

    expect(result.status).toBe("updated");
    expect(hookContent.startsWith("#!/bin/sh\n\n# react-doctor hook start")).toBe(true);
    expect(hookContent).toContain("npm test\n");
  });

  it("updates the React Doctor block instead of duplicating it", () => {
    installReactDoctorGitHook({ hookPath: fixture.hookPath, projectRoot: fixture.projectRoot });
    installReactDoctorGitHook({ hookPath: fixture.hookPath, projectRoot: fixture.projectRoot });

    const hookContent = readHook(fixture.hookPath);
    const managedBlockMatches = hookContent.match(/# react-doctor hook start/g) ?? [];

    expect(managedBlockMatches).toHaveLength(1);
    expect(hookContent).toContain("react-doctor --staged --blocking warning");
  });

  it("replaces the legacy managed-runner launcher block", () => {
    const legacyRunnerPath = path.join(fixture.projectRoot, ".react-doctor/hooks/pre-commit");
    fs.mkdirSync(path.dirname(fixture.hookPath), { recursive: true });
    fs.mkdirSync(path.dirname(legacyRunnerPath), { recursive: true });
    fs.writeFileSync(legacyRunnerPath, "#!/bin/sh\nprintf stale-runner\n");
    fs.writeFileSync(
      fixture.hookPath,
      [
        "#!/bin/sh",
        "",
        "# react-doctor hook launcher start",
        'if [ -f ".react-doctor/hooks/pre-commit" ]; then',
        '  sh ".react-doctor/hooks/pre-commit"',
        "fi",
        "# react-doctor hook launcher end",
        "",
      ].join("\n"),
    );

    installReactDoctorGitHook({ hookPath: fixture.hookPath, projectRoot: fixture.projectRoot });

    const hookContent = readHook(fixture.hookPath);
    expect(hookContent).toContain("# react-doctor hook start");
    expect(hookContent).toContain("react-doctor --staged --blocking warning");
    expect(hookContent).not.toContain("hook launcher");
    expect(hookContent).not.toContain(".react-doctor/hooks/pre-commit");
    expect(fs.existsSync(legacyRunnerPath)).toBe(false);
    expect(fs.existsSync(path.dirname(legacyRunnerPath))).toBe(false);
  });

  it("detects the default hook path at the repository root when run from a subdirectory", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    const packageDirectory = path.join(fixture.projectRoot, "packages/app");
    fs.mkdirSync(packageDirectory, { recursive: true });
    const realProjectRoot = fs.realpathSync(fixture.projectRoot);

    const target = detectGitHookTarget(packageDirectory);
    if (target === null) throw new Error("Expected git hook target");

    expect(fs.realpathSync(path.dirname(target.hookPath))).toBe(
      path.join(realProjectRoot, ".git/hooks"),
    );
    expect(path.basename(target.hookPath)).toBe("pre-commit");
    expect(target.runnerRoot).toBe(realProjectRoot);
    expect(target.kind).toBe("git");
  });

  it("detects a configured hooks directory from a subdirectory", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
      cwd: fixture.projectRoot,
    });
    const packageDirectory = path.join(fixture.projectRoot, "packages/app");
    fs.mkdirSync(packageDirectory, { recursive: true });
    const realProjectRoot = fs.realpathSync(fixture.projectRoot);

    const target = detectGitHookTarget(packageDirectory);

    expect(target).toEqual({
      hookPath: path.join(realProjectRoot, ".githooks/pre-commit"),
      runnerRoot: realProjectRoot,
      kind: "configured",
    });
  });

  it("detects an absolute configured hooks directory", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    const hooksDirectory = path.join(fixture.projectRoot, "absolute-hooks");
    execFileSync("git", ["config", "core.hooksPath", hooksDirectory], {
      cwd: fixture.projectRoot,
    });
    const packageDirectory = path.join(fixture.projectRoot, "packages/app");
    fs.mkdirSync(packageDirectory, { recursive: true });
    const realProjectRoot = fs.realpathSync(fixture.projectRoot);

    const target = detectGitHookTarget(packageDirectory);

    expect(target).toEqual({
      hookPath: path.join(hooksDirectory, "pre-commit"),
      runnerRoot: realProjectRoot,
      kind: "configured",
    });
  });

  it("keeps an explicit core.hooksPath ahead of hook manager detection", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    execFileSync("git", ["config", "core.hooksPath", ".custom-hooks"], {
      cwd: fixture.projectRoot,
    });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        husky: "^9.0.0",
        "vite-plus": "^0.1.20",
      },
    });
    const realProjectRoot = fs.realpathSync(fixture.projectRoot);

    const target = detectGitHookTarget(fixture.projectRoot);

    expect(target).toEqual({
      hookPath: path.join(realProjectRoot, ".custom-hooks/pre-commit"),
      runnerRoot: realProjectRoot,
      kind: "configured",
    });
  });

  it("uses Husky when the project has Husky installed", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        husky: "^9.0.0",
      },
    });
    const realProjectRoot = fs.realpathSync(fixture.projectRoot);

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    const result = installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    expect(target).toEqual({
      hookPath: path.join(realProjectRoot, ".husky/pre-commit"),
      runnerRoot: realProjectRoot,
      kind: "husky",
      hooksPathConfig: ".husky",
    });
    expect(result.kind).toBe("husky");
    expect(
      execFileSync("git", ["config", "--path", "--get", "core.hooksPath"], {
        cwd: fixture.projectRoot,
        encoding: "utf8",
      }).trim(),
    ).toBe(".husky");
    expect(readHook(target.hookPath)).toContain("react-doctor --staged --blocking warning");
  });

  it("uses Vite Plus hooks when the project has Vite Plus installed", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        "vite-plus": "^0.1.20",
      },
    });
    const realProjectRoot = fs.realpathSync(fixture.projectRoot);

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    const result = installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    expect(target).toEqual({
      hookPath: path.join(realProjectRoot, ".vite-hooks/pre-commit"),
      runnerRoot: realProjectRoot,
      kind: "vite-plus",
      hooksPathConfig: ".vite-hooks",
    });
    expect(result.kind).toBe("vite-plus");
    expect(
      execFileSync("git", ["config", "--path", "--get", "core.hooksPath"], {
        cwd: fixture.projectRoot,
        encoding: "utf8",
      }).trim(),
    ).toBe(".vite-hooks");
    expect(readHook(target.hookPath)).toContain("react-doctor --staged --blocking warning");
  });

  it("uses Husky before Vite Plus when both are present", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        husky: "^9.0.0",
        "vite-plus": "^0.1.20",
      },
    });
    const realProjectRoot = fs.realpathSync(fixture.projectRoot);

    const target = detectGitHookTarget(fixture.projectRoot);

    expect(target).toEqual({
      hookPath: path.join(realProjectRoot, ".husky/pre-commit"),
      runnerRoot: realProjectRoot,
      kind: "husky",
      hooksPathConfig: ".husky",
    });
  });

  it("updates package.json simple-git-hooks config", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      scripts: {
        test: "echo test",
      },
      devDependencies: {
        "simple-git-hooks": "^2.11.0",
      },
      "simple-git-hooks": {
        "pre-commit": "pnpm lint",
      },
    });

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const packageJson = readJsonFile<{
      "simple-git-hooks": { "pre-commit": string };
    }>(path.join(fixture.projectRoot, "package.json"));
    const preCommit = packageJson["simple-git-hooks"]["pre-commit"];
    expect(target.kind).toBe("simple-git-hooks");
    expect(preCommit).toContain("pnpm lint");
    expect(preCommit.match(/react_doctor_output=\$\(mktemp/g)).toHaveLength(1);
    expect(preCommit).toContain("react-doctor --staged --blocking warning");
  });

  it("creates lefthook config for lefthook projects", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        lefthook: "^1.13.0",
      },
    });

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const configContent = fs.readFileSync(path.join(fixture.projectRoot, "lefthook.yml"), "utf8");
    expect(target.kind).toBe("lefthook");
    expect(configContent.match(/react_doctor_output=\$\(mktemp/g)).toHaveLength(1);
    expect(configContent).toContain("run: react_doctor_output=$(mktemp");
    expect(configContent).toContain("React Doctor found staged regressions.");
  });

  it("merges React Doctor into an existing Lefthook pre-commit section", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    const configPath = path.join(fixture.projectRoot, "lefthook.yml");
    fs.writeFileSync(
      configPath,
      [
        "pre-commit:",
        "  commands:",
        "    lint:",
        "      run: pnpm lint",
        "commit-msg:",
        "  commands:",
        "    commitlint:",
        "      run: commitlint --edit",
        "",
      ].join("\n"),
    );

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const configContent = fs.readFileSync(configPath, "utf8");
    const preCommitSection = configContent.slice(0, configContent.indexOf("commit-msg:"));
    expect(configContent.match(/^pre-commit:/gm)).toHaveLength(1);
    expect(preCommitSection.match(/^  commands:/gm)).toHaveLength(1);
    expect(configContent).toContain("    lint:\n      run: pnpm lint");
    expect(configContent).toContain("    react-doctor:\n      run: react_doctor_output=$(mktemp");
    expect(configContent).toContain("commit-msg:");
  });

  it("updates pre-commit config with a local hook", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    const configPath = path.join(fixture.projectRoot, ".pre-commit-config.yaml");
    fs.writeFileSync(configPath, "repos:\n");

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const configContent = fs.readFileSync(configPath, "utf8");
    expect(target.kind).toBe("pre-commit");
    expect(configContent.match(/id: react-doctor/g)).toHaveLength(1);
    expect(configContent).toContain("entry: sh -c 'react_doctor_output=$(mktemp");
  });

  it("updates Overcommit config", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    const configPath = path.join(fixture.projectRoot, ".overcommit.yml");
    fs.writeFileSync(configPath, "CommitMsg:\n  CapitalizedSubject:\n    enabled: true\n");

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const configContent = fs.readFileSync(configPath, "utf8");
    expect(target.kind).toBe("overcommit");
    expect(configContent.match(/ReactDoctor/g)).toHaveLength(1);
    expect(configContent).toContain("command: ['sh', '-c', 'react_doctor_output=$(mktemp");
  });

  it("merges React Doctor into an existing Overcommit PreCommit section", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    const configPath = path.join(fixture.projectRoot, ".overcommit.yml");
    fs.writeFileSync(
      configPath,
      [
        "PreCommit:",
        "  RuboCop:",
        "    enabled: true",
        "CommitMsg:",
        "  CapitalizedSubject:",
        "    enabled: true",
        "",
      ].join("\n"),
    );

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const configContent = fs.readFileSync(configPath, "utf8");
    expect(configContent.match(/^PreCommit:/gm)).toHaveLength(1);
    expect(configContent).toContain("  RuboCop:\n    enabled: true");
    expect(configContent).toContain("  ReactDoctor:\n    enabled: true");
    expect(configContent).toContain("CommitMsg:");
  });

  it("updates Yorkie gitHooks config", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        yorkie: "^2.0.0",
      },
      gitHooks: {
        "pre-commit": "pnpm lint",
      },
    });

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const packageJson = readJsonFile<{ gitHooks: { "pre-commit": string } }>(
      path.join(fixture.projectRoot, "package.json"),
    );
    expect(target.kind).toBe("yorkie");
    expect(packageJson.gitHooks["pre-commit"]).toContain("pnpm lint");
    expect(packageJson.gitHooks["pre-commit"]).toContain(
      "react-doctor --staged --blocking warning",
    );
  });

  it("updates ghooks config", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        ghooks: "^2.0.0",
      },
      config: {
        ghooks: {
          "pre-commit": "pnpm lint",
        },
      },
    });

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const packageJson = readJsonFile<{ config: { ghooks: { "pre-commit": string } } }>(
      path.join(fixture.projectRoot, "package.json"),
    );
    expect(target.kind).toBe("ghooks");
    expect(packageJson.config.ghooks["pre-commit"]).toContain("pnpm lint");
    expect(packageJson.config.ghooks["pre-commit"]).toContain(
      "react-doctor --staged --blocking warning",
    );
  });

  it("does not detect unrelated top-level ghooks package metadata", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      ghooks: {
        notes: "not a hook config",
      },
    });

    const target = detectGitHookTarget(fixture.projectRoot);

    expect(target?.kind).toBe("git");
  });

  it("updates git-hooks-js config", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        "git-hooks-js": "^1.0.0",
      },
      "git-hooks": {
        "pre-commit": "pnpm lint",
      },
    });

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const packageJson = readJsonFile<{ "git-hooks": { "pre-commit": string } }>(
      path.join(fixture.projectRoot, "package.json"),
    );
    expect(target.kind).toBe("git-hooks-js");
    expect(packageJson["git-hooks"]["pre-commit"]).toContain("pnpm lint");
    expect(packageJson["git-hooks"]["pre-commit"]).toContain(
      "react-doctor --staged --blocking warning",
    );
  });

  it("updates npm pre-commit package config", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        "pre-commit": "^1.2.2",
      },
      "pre-commit": ["lint"],
    });

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const packageJson = readJsonFile<{ "pre-commit": string[] }>(
      path.join(fixture.projectRoot, "package.json"),
    );
    expect(target.kind).toBe("pre-commit-npm");
    expect(packageJson["pre-commit"]).toHaveLength(2);
    expect(packageJson["pre-commit"][0]).toBe("lint");
    expect(packageJson["pre-commit"][1]).toContain("react-doctor --staged --blocking warning");
  });

  it("does not treat lint-staged as a hook manager by itself", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        "lint-staged": "^16.0.0",
      },
      "lint-staged": {
        "*.ts": "eslint",
      },
    });

    const target = detectGitHookTarget(fixture.projectRoot);

    expect(target?.kind).toBe("git");
  });

  it("does not treat nano-staged as a hook manager by itself", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        "nano-staged": "^0.8.0",
      },
      "nano-staged": {
        "*.ts": "eslint",
      },
    });

    const target = detectGitHookTarget(fixture.projectRoot);

    expect(target?.kind).toBe("git");
  });

  it("updates pretty-quick through gitHooks config", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        "pretty-quick": "^4.0.0",
      },
    });

    const target = detectGitHookTarget(fixture.projectRoot);
    if (target === null) throw new Error("Expected git hook target");
    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const packageJson = readJsonFile<{ gitHooks: { "pre-commit": string } }>(
      path.join(fixture.projectRoot, "package.json"),
    );
    expect(target.kind).toBe("pretty-quick");
    expect(packageJson.gitHooks["pre-commit"]).toContain(
      "react-doctor --staged --blocking warning",
    );
  });

  it("runs through a configured hooks directory during a real git commit", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "doctor@example.com"], {
      cwd: fixture.projectRoot,
    });
    execFileSync("git", ["config", "user.name", "React Doctor"], { cwd: fixture.projectRoot });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: fixture.projectRoot });
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
      cwd: fixture.projectRoot,
    });
    const packageDirectory = path.join(fixture.projectRoot, "packages/app");
    fs.mkdirSync(packageDirectory, { recursive: true });
    const target = detectGitHookTarget(packageDirectory);
    if (target === null) throw new Error("Expected git hook target");

    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const localBinaryPath = path.join(fixture.projectRoot, "node_modules/.bin/react-doctor");
    const invocationPath = path.join(fixture.projectRoot, "hook-invocation.txt");
    fs.mkdirSync(path.dirname(localBinaryPath), { recursive: true });
    fs.writeFileSync(
      localBinaryPath,
      ["#!/bin/sh", "printf '%s\\n' \"$@\" > hook-invocation.txt", "exit 0", ""].join("\n"),
    );
    fs.chmodSync(localBinaryPath, fs.constants.S_IRWXU);

    fs.writeFileSync(path.join(packageDirectory, "app.tsx"), "export const App = () => null;\n");
    execFileSync("git", ["add", "packages/app/app.tsx"], { cwd: fixture.projectRoot });
    execFileSync("git", ["commit", "-m", "test configured hook"], {
      cwd: packageDirectory,
      encoding: "utf8",
    });

    expect(target.hookPath).toBe(
      path.join(fs.realpathSync(fixture.projectRoot), ".githooks/pre-commit"),
    );
    expect(fs.readFileSync(invocationPath, "utf8")).toBe("--staged\n--blocking\nwarning\n");
  });

  it("prints a minimal non-invasive prompt during a real git commit", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "doctor@example.com"], {
      cwd: fixture.projectRoot,
    });
    execFileSync("git", ["config", "user.name", "React Doctor"], { cwd: fixture.projectRoot });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: fixture.projectRoot });

    const packageDirectory = path.join(fixture.projectRoot, "packages/app");
    fs.mkdirSync(packageDirectory, { recursive: true });
    const target = detectGitHookTarget(packageDirectory);
    if (target === null) throw new Error("Expected git hook target");

    installReactDoctorGitHook({
      hookPath: target.hookPath,
      projectRoot: target.runnerRoot,
      kind: target.kind,
      hooksPathConfig: target.hooksPathConfig,
    });

    const localBinaryPath = path.join(fixture.projectRoot, "node_modules/.bin/react-doctor");
    const invocationPath = path.join(fixture.projectRoot, "hook-invocation.txt");
    fs.mkdirSync(path.dirname(localBinaryPath), { recursive: true });
    fs.writeFileSync(
      localBinaryPath,
      [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" > hook-invocation.txt",
        "printf '%s\\n' 'noisy stdout diagnostic'",
        "printf '%s\\n' 'noisy stderr diagnostic' >&2",
        "exit 1",
        "",
      ].join("\n"),
    );
    fs.chmodSync(localBinaryPath, fs.constants.S_IRWXU);

    fs.writeFileSync(path.join(packageDirectory, "app.tsx"), "export const App = () => null;\n");
    execFileSync("git", ["add", "packages/app/app.tsx"], { cwd: fixture.projectRoot });
    const commitResult = spawnSync("git", ["commit", "-m", "test hook"], {
      cwd: packageDirectory,
      encoding: "utf8",
    });

    expect(commitResult.status).toBe(0);
    expect(commitResult.stderr).toContain("React Doctor found staged regressions.");
    expect(commitResult.stderr).toContain(
      "Run react-doctor --staged --blocking warning to inspect.",
    );
    expect(commitResult.stderr).toContain(
      "Want them fixed? Ask your agent to run that command and resolve the findings.",
    );
    expect(commitResult.stderr).not.toContain("noisy stdout diagnostic");
    expect(commitResult.stderr).not.toContain("noisy stderr diagnostic");
    expect(commitResult.stderr).not.toContain("Stop commit");
    expect(fs.readFileSync(invocationPath, "utf8")).toBe("--staged\n--blocking\nwarning\n");
    expect(
      execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: fixture.projectRoot,
        encoding: "utf8",
      }).trim(),
    ).toHaveLength(40);
  });

  it("preserves and executes existing hook content during a real git commit", () => {
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "doctor@example.com"], {
      cwd: fixture.projectRoot,
    });
    execFileSync("git", ["config", "user.name", "React Doctor"], { cwd: fixture.projectRoot });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: fixture.projectRoot });
    fs.mkdirSync(path.dirname(fixture.hookPath), { recursive: true });
    fs.writeFileSync(
      fixture.hookPath,
      "#!/bin/sh\nprintf '%s\\n' existing-hook > existing-hook-ran.txt\n",
    );

    installReactDoctorGitHook({
      hookPath: fixture.hookPath,
      projectRoot: fixture.projectRoot,
    });

    const localBinaryPath = path.join(fixture.projectRoot, "node_modules/.bin/react-doctor");
    const invocationPath = path.join(fixture.projectRoot, "hook-invocation.txt");
    fs.mkdirSync(path.dirname(localBinaryPath), { recursive: true });
    fs.writeFileSync(
      localBinaryPath,
      ["#!/bin/sh", "printf '%s\\n' \"$@\" > hook-invocation.txt", "exit 0", ""].join("\n"),
    );
    fs.chmodSync(localBinaryPath, fs.constants.S_IRWXU);

    fs.writeFileSync(path.join(fixture.projectRoot, "app.tsx"), "export const App = () => null;\n");
    execFileSync("git", ["add", "app.tsx"], { cwd: fixture.projectRoot });
    execFileSync("git", ["commit", "-m", "test existing hook"], {
      cwd: fixture.projectRoot,
      encoding: "utf8",
    });

    expect(fs.readFileSync(invocationPath, "utf8")).toBe("--staged\n--blocking\nwarning\n");
    expect(fs.readFileSync(path.join(fixture.projectRoot, "existing-hook-ran.txt"), "utf8")).toBe(
      "existing-hook\n",
    );
  });
});
