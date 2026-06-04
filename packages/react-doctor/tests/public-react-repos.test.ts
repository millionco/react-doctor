import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { inspect } from "../src/inspect.js";
import {
  COMMAND_MAX_BUFFER_BYTES,
  GIT_CLONE_TIMEOUT_MS,
  PUBLIC_REACT_REPOSITORIES,
  PUBLIC_REPO_SCAN_TIMEOUT_MS,
  PUBLIC_REPO_SMOKE_ENABLED_VALUE,
  PUBLIC_REPO_SMOKE_ENV_VAR,
  PUBLIC_REPO_TEMP_DIR_PREFIX,
  PUBLIC_REPO_TEST_TIMEOUT_MS,
  type PublicReactRepository,
} from "./public-react-repos/constants.js";

interface CommandOptions {
  cwd?: string;
  timeoutMilliseconds: number;
}

interface PublicRepoScanResult {
  repository: PublicReactRepository;
  checkoutDirectory: string;
  diagnosticCount: number;
  sourceFileCount: number;
}

const describePublicRepoSmoke =
  process.env[PUBLIC_REPO_SMOKE_ENV_VAR] === PUBLIC_REPO_SMOKE_ENABLED_VALUE
    ? describe
    : describe.skip;

let temporaryDirectory: string;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const formatErrorOutput = (error: unknown, field: "stdout" | "stderr"): string => {
  if (!isRecord(error)) return "";
  const value = error[field];
  if (typeof value === "string") return value.trim();
  if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
  return "";
};

const formatCommandError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = formatErrorOutput(error, "stderr");
  const stdout = formatErrorOutput(error, "stdout");
  return [message, stderr, stdout].filter(Boolean).join("\n");
};

const runCommand = (command: string, args: string[], options: CommandOptions): string => {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
      maxBuffer: COMMAND_MAX_BUFFER_BYTES,
      stdio: "pipe",
      timeout: options.timeoutMilliseconds,
    }).trim();
  } catch (error) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${options.cwd ?? process.cwd()}\n${formatCommandError(error)}`,
    );
  }
};

const checkoutDirectoryFor = (repository: PublicReactRepository): string =>
  path.join(temporaryDirectory, repository.slug.replaceAll("/", "__").replaceAll(".", "-"));

const cloneRepository = (repository: PublicReactRepository): string => {
  const checkoutDirectory = checkoutDirectoryFor(repository);
  runCommand(
    "git",
    [
      "clone",
      "--depth=1",
      "--single-branch",
      "--filter=blob:none",
      "--no-tags",
      repository.url,
      checkoutDirectory,
    ],
    { timeoutMilliseconds: GIT_CLONE_TIMEOUT_MS },
  );
  return checkoutDirectory;
};

const withTimeout = async <Value>(
  promise: Promise<Value>,
  timeoutMilliseconds: number,
  timeoutMessage: string,
): Promise<Value> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMilliseconds);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

const inspectRepository = async (
  repository: PublicReactRepository,
): Promise<PublicRepoScanResult> => {
  const checkoutDirectory = cloneRepository(repository);
  const result = await inspect(checkoutDirectory, {
    lint: true,
    deadCode: false,
    noScore: true,
    silent: true,
    isCi: true,
    configOverride: {
      adoptExistingLintConfig: false,
      deadCode: false,
      noScore: true,
      share: false,
    },
  });

  expect(result.project.reactVersion).not.toBeNull();
  expect(result.project.sourceFileCount).toBeGreaterThan(0);
  expect(result.skippedChecks).not.toContain("lint");

  return {
    repository,
    checkoutDirectory,
    diagnosticCount: result.diagnostics.length,
    sourceFileCount: result.project.sourceFileCount,
  };
};

describePublicRepoSmoke(`public React repository smoke (${PUBLIC_REPO_SMOKE_ENV_VAR}=1)`, () => {
  beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), PUBLIC_REPO_TEMP_DIR_PREFIX));
  });

  afterAll(() => {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  for (const repository of PUBLIC_REACT_REPOSITORIES) {
    it(
      `clones and scans ${repository.name}`,
      async () => {
        const scanResult = await withTimeout(
          inspectRepository(repository),
          PUBLIC_REPO_SCAN_TIMEOUT_MS,
          `${repository.slug} scan exceeded the timeout budget`,
        );

        expect(scanResult.repository.slug).toBe(repository.slug);
        expect(scanResult.checkoutDirectory).toContain(temporaryDirectory);
        expect(scanResult.diagnosticCount).toBeGreaterThanOrEqual(0);
        expect(scanResult.sourceFileCount).toBeGreaterThan(0);
      },
      PUBLIC_REPO_TEST_TIMEOUT_MS,
    );
  }
});
