import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { CORPUS_DIRECTORY } from "./constants.ts";
import { parseUserArguments } from "./parse-performance-arguments.ts";
import {
  corpusCheckoutDirectory,
  corpusTargetDirectory,
  readCorpusManifest,
  selectCorpusTargets,
} from "./read-corpus-manifest.ts";
import { runCommanderMain } from "./run-commander-main.ts";
import type { CorpusTarget } from "./types.ts";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");

interface FetchCorpusCommandOptions {
  readonly list: boolean;
  readonly dir: string;
}

const runGitOrThrow = (directory: string, argumentsList: string[]): string => {
  const result = spawnSync("git", argumentsList, {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${argumentsList.join(" ")} failed in ${directory} (status ${result.status})`,
    );
  }
  return result.stdout;
};

const readHeadSha = (directory: string): string | null => {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
};

export const fetchCorpusCheckout = (target: CorpusTarget, corpusDirectory: string): string => {
  const checkoutDirectory = corpusCheckoutDirectory(target, corpusDirectory);
  if (!fs.existsSync(path.join(checkoutDirectory, ".git"))) {
    fs.mkdirSync(checkoutDirectory, { recursive: true });
    runGitOrThrow(checkoutDirectory, ["init", "-q"]);
    runGitOrThrow(checkoutDirectory, [
      "remote",
      "add",
      "origin",
      `https://github.com/${target.repository}.git`,
    ]);
  }
  if (readHeadSha(checkoutDirectory) !== target.sha) {
    process.stderr.write(`[${target.name}] fetching ${target.repository}@${target.sha}\n`);
    runGitOrThrow(checkoutDirectory, ["fetch", "-q", "--depth", "1", "origin", target.sha]);
    runGitOrThrow(checkoutDirectory, ["checkout", "-q", "--detach", target.sha]);
  }
  const targetDirectory = corpusTargetDirectory(target, corpusDirectory);
  if (!fs.existsSync(targetDirectory)) {
    throw new Error(`Corpus target ${target.name} is missing ${targetDirectory}`);
  }
  return targetDirectory;
};

const main = (): void => {
  const command = new Command()
    .name("react-doctor-performance-corpus")
    .description("Shallow-clone the pinned benchmark corpus into a gitignored directory")
    .argument("[names...]", "corpus target names (defaults to every target)")
    .option("--list", "list the corpus targets without fetching", false)
    .option("--dir <directory>", "corpus checkout directory", CORPUS_DIRECTORY)
    .showHelpAfterError()
    .allowExcessArguments(false)
    .exitOverride();
  parseUserArguments(command, process.argv.slice(2));
  const commandOptions = command.opts<FetchCorpusCommandOptions>();
  const namesArgument: unknown = command.processedArgs[0];
  const names = Array.isArray(namesArgument)
    ? namesArgument.filter((entry): entry is string => typeof entry === "string")
    : [];
  const manifest = readCorpusManifest();
  const targets = names.length === 0 ? manifest : selectCorpusTargets(manifest, names);
  const corpusDirectory = path.resolve(REPOSITORY_ROOT, commandOptions.dir);
  for (const target of targets) {
    const targetDirectory = commandOptions.list
      ? corpusTargetDirectory(target, corpusDirectory)
      : fetchCorpusCheckout(target, corpusDirectory);
    process.stdout.write(
      `${target.name}\t${target.repository}@${target.sha.slice(0, 12)}${target.subdirectory === undefined ? "" : `/${target.subdirectory}`}\t${targetDirectory}\n`,
    );
  }
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCommanderMain(main);
