import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ACTION_YAML_PATH = path.join(REPOSITORY_ROOT, "action.yml");

const readActionYaml = (): string =>
  fs.readFileSync(ACTION_YAML_PATH, "utf8").replaceAll("\r\n", "\n");

const GIT_TEST_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "react-doctor-test",
  GIT_AUTHOR_EMAIL: "test@react.doctor",
  GIT_COMMITTER_NAME: "react-doctor-test",
  GIT_COMMITTER_EMAIL: "test@react.doctor",
};

const runGit = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, env: GIT_TEST_ENV, encoding: "utf8" }).trim();

const BASE_STEP_RUN_MARKER = "run: |\n";

const extractStepScript = (actionYaml: string, marker = "- id: base"): string => {
  const markerIndex = actionYaml.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing action.yml step marker: ${marker}`);
  const stepStartIndex = actionYaml.lastIndexOf("\n    - ", markerIndex);
  const stepEndIndex = actionYaml.indexOf("\n    - ", markerIndex + marker.length);
  const baseStep = actionYaml.slice(
    stepStartIndex < 0 ? 0 : stepStartIndex,
    stepEndIndex < 0 ? undefined : stepEndIndex,
  );
  const runIndex = baseStep.indexOf(BASE_STEP_RUN_MARKER);
  if (runIndex < 0) throw new Error("Missing run block on the requested step");
  const scriptLines: string[] = [];
  for (const rawLine of baseStep.slice(runIndex + BASE_STEP_RUN_MARKER.length).split("\n")) {
    if (rawLine.trim() !== "" && !rawLine.startsWith("        ")) break;
    scriptLines.push(rawLine.slice(8));
  }
  return scriptLines.join("\n");
};

const itOnPosix = process.platform === "win32" ? it.skip : it;

describe("GitHub Action fetch-depth shallow conversion regression (issue #1961)", () => {
  itOnPosix(
    "does not convert a full clone to shallow when the base commit is already present",
    () => {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-action-1961-"));
      try {
        const originDirectory = path.join(fixtureRoot, "origin");
        const checkoutDirectory = path.join(fixtureRoot, "checkout");
        const runnerTemp = path.join(fixtureRoot, "runner-temp");
        fs.mkdirSync(originDirectory);
        fs.mkdirSync(checkoutDirectory);
        fs.mkdirSync(runnerTemp);

        runGit(originDirectory, "init", "--initial-branch=main");
        runGit(originDirectory, "config", "uploadpack.allowAnySHA1InWant", "true");

        fs.mkdirSync(path.join(originDirectory, "src"));
        fs.writeFileSync(
          path.join(originDirectory, "src", "app.tsx"),
          "export const App = () => null;\n",
        );
        runGit(originDirectory, "add", ".");
        runGit(originDirectory, "-c", "commit.gpgsign=false", "commit", "-m", "initial");

        fs.writeFileSync(
          path.join(originDirectory, "src", "base.tsx"),
          "export const Base = () => null;\n",
        );
        runGit(originDirectory, "add", ".");
        runGit(originDirectory, "-c", "commit.gpgsign=false", "commit", "-m", "base commit");
        const baseSha = runGit(originDirectory, "rev-parse", "HEAD");

        runGit(originDirectory, "checkout", "-b", "pr");
        fs.writeFileSync(
          path.join(originDirectory, "src", "feature.tsx"),
          "export const Feature = () => null;\n",
        );
        runGit(originDirectory, "add", ".");
        runGit(originDirectory, "-c", "commit.gpgsign=false", "commit", "-m", "feature");
        const prHeadSha = runGit(originDirectory, "rev-parse", "HEAD");

        runGit(originDirectory, "checkout", "main");
        fs.writeFileSync(
          path.join(originDirectory, "src", "main-update.tsx"),
          "export const MainUpdate = () => null;\n",
        );
        runGit(originDirectory, "add", ".");
        runGit(originDirectory, "-c", "commit.gpgsign=false", "commit", "-m", "main update");

        runGit(checkoutDirectory, "init");
        runGit(checkoutDirectory, "remote", "add", "origin", pathToFileURL(originDirectory).href);
        runGit(checkoutDirectory, "fetch", "--no-tags", "origin");

        const isShallowBefore = fs.existsSync(path.join(checkoutDirectory, ".git", "shallow"));
        expect(isShallowBefore).toBe(false);

        const changedFilesFile = path.join(runnerTemp, "react-doctor-changed-files.txt");
        const githubOutputFile = path.join(runnerTemp, "github-output.txt");
        fs.writeFileSync(githubOutputFile, "");

        const scriptOutput = execFileSync(
          "bash",
          [
            "--noprofile",
            "--norc",
            "-e",
            "-o",
            "pipefail",
            "-c",
            extractStepScript(readActionYaml()),
          ],
          {
            cwd: checkoutDirectory,
            encoding: "utf8",
            env: {
              ...GIT_TEST_ENV,
              INPUT_DIRECTORY: ".",
              BASE_SHA: baseSha,
              HEAD_SHA: prHeadSha,
              CHANGED_FILES_FILE: changedFilesFile,
              RUNNER_TEMP: runnerTemp,
              GITHUB_OUTPUT: githubOutputFile,
              GITHUB_ACTION_PATH: REPOSITORY_ROOT,
            },
          },
        );

        const isShallowAfter = fs.existsSync(path.join(checkoutDirectory, ".git", "shallow"));
        expect(isShallowAfter).toBe(false);

        expect(scriptOutput).not.toContain("could not derive");
        expect(fs.existsSync(changedFilesFile)).toBe(true);
        const changedFiles = fs
          .readFileSync(changedFilesFile, "utf8")
          .split("\n")
          .filter((line) => line.trim() !== "");

        expect(changedFiles).toEqual(["src/feature.tsx"]);

        const mergeBase = runGit(checkoutDirectory, "merge-base", baseSha, prHeadSha);
        expect(mergeBase).toBeTruthy();
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
    30_000,
  );

  itOnPosix(
    "still fetches the base commit when it is missing in a shallow checkout",
    () => {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-action-1961-fetch-"));
      try {
        const originDirectory = path.join(fixtureRoot, "origin");
        const checkoutDirectory = path.join(fixtureRoot, "checkout");
        const runnerTemp = path.join(fixtureRoot, "runner-temp");
        fs.mkdirSync(originDirectory);
        fs.mkdirSync(checkoutDirectory);
        fs.mkdirSync(runnerTemp);

        runGit(originDirectory, "init", "--initial-branch=main");
        runGit(originDirectory, "config", "uploadpack.allowAnySHA1InWant", "true");

        fs.mkdirSync(path.join(originDirectory, "src"));
        fs.writeFileSync(
          path.join(originDirectory, "src", "app.tsx"),
          "export const App = () => null;\n",
        );
        runGit(originDirectory, "add", ".");
        runGit(originDirectory, "-c", "commit.gpgsign=false", "commit", "-m", "base commit");
        const baseSha = runGit(originDirectory, "rev-parse", "HEAD");

        runGit(originDirectory, "checkout", "-b", "pr");
        fs.writeFileSync(
          path.join(originDirectory, "src", "feature.tsx"),
          "export const Feature = () => null;\n",
        );
        runGit(originDirectory, "add", ".");
        runGit(originDirectory, "-c", "commit.gpgsign=false", "commit", "-m", "feature");
        const prHeadSha = runGit(originDirectory, "rev-parse", "HEAD");

        runGit(checkoutDirectory, "init");
        runGit(checkoutDirectory, "remote", "add", "origin", pathToFileURL(originDirectory).href);
        runGit(checkoutDirectory, "fetch", "--depth=1", "--no-tags", "origin", "pr");
        runGit(checkoutDirectory, "-c", "advice.detachedHead=false", "checkout", "FETCH_HEAD");

        let baseExistsBefore = false;
        try {
          execFileSync("git", ["cat-file", "-e", `${baseSha}^{commit}`], {
            cwd: checkoutDirectory,
            env: GIT_TEST_ENV,
            stdio: "ignore",
          });
          baseExistsBefore = true;
        } catch {
          baseExistsBefore = false;
        }
        expect(baseExistsBefore).toBe(false);

        const changedFilesFile = path.join(runnerTemp, "react-doctor-changed-files.txt");
        const githubOutputFile = path.join(runnerTemp, "github-output.txt");
        fs.writeFileSync(githubOutputFile, "");

        execFileSync(
          "bash",
          [
            "--noprofile",
            "--norc",
            "-e",
            "-o",
            "pipefail",
            "-c",
            extractStepScript(readActionYaml()),
          ],
          {
            cwd: checkoutDirectory,
            encoding: "utf8",
            env: {
              ...GIT_TEST_ENV,
              INPUT_DIRECTORY: ".",
              BASE_SHA: baseSha,
              HEAD_SHA: prHeadSha,
              CHANGED_FILES_FILE: changedFilesFile,
              RUNNER_TEMP: runnerTemp,
              GITHUB_OUTPUT: githubOutputFile,
              GITHUB_ACTION_PATH: REPOSITORY_ROOT,
            },
          },
        );

        let baseExistsAfter = false;
        try {
          execFileSync("git", ["cat-file", "-e", `${baseSha}^{commit}`], {
            cwd: checkoutDirectory,
            env: GIT_TEST_ENV,
            stdio: "ignore",
          });
          baseExistsAfter = true;
        } catch {
          baseExistsAfter = false;
        }
        expect(baseExistsAfter).toBe(true);
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
