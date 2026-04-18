import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { parseOxlintOutput } from "react-doctor-core";
import { OXLINT_MAX_FILES_PER_BATCH, SPAWN_ARGS_MAX_LENGTH_CHARS } from "../constants.js";
import { createOxlintConfig } from "../oxlint-config.js";
import type { Diagnostic, Framework } from "../types.js";
import { neutralizeDisableDirectives } from "./neutralize-disable-directives.js";

const esmRequire = createRequire(import.meta.url);

const resolveOxlintBinary = (): string => {
  const oxlintMainPath = esmRequire.resolve("oxlint");
  const oxlintPackageDirectory = path.resolve(path.dirname(oxlintMainPath), "..");
  return path.join(oxlintPackageDirectory, "bin", "oxlint");
};

const resolvePluginPath = (): string => {
  const reactDoctorPackageRoot = path.dirname(esmRequire.resolve("react-doctor/package.json"));
  const distPluginPath = path.join(reactDoctorPackageRoot, "dist", "react-doctor-plugin.js");
  if (fs.existsSync(distPluginPath)) return distPluginPath;

  const corePackageRoot = path.dirname(esmRequire.resolve("react-doctor-core/package.json"));
  const sourcePluginPath = path.join(corePackageRoot, "src", "plugin", "index.ts");
  if (fs.existsSync(sourcePluginPath)) return sourcePluginPath;

  return distPluginPath;
};

const estimateArgsLength = (args: string[]): number =>
  args.reduce((total, argument) => total + argument.length + 1, 0);

const batchIncludePaths = (baseArgs: string[], includePaths: string[]): string[][] => {
  const baseArgsLength = estimateArgsLength(baseArgs);
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentBatchLength = baseArgsLength;

  for (const filePath of includePaths) {
    const entryLength = filePath.length + 1;
    const exceedsArgLength =
      currentBatch.length > 0 && currentBatchLength + entryLength > SPAWN_ARGS_MAX_LENGTH_CHARS;
    const exceedsFileCount = currentBatch.length >= OXLINT_MAX_FILES_PER_BATCH;

    if (exceedsArgLength || exceedsFileCount) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchLength = baseArgsLength;
    }
    currentBatch.push(filePath);
    currentBatchLength += entryLength;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
};

const spawnOxlint = (
  args: string[],
  rootDirectory: string,
  nodeBinaryPath: string,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(nodeBinaryPath, args, {
      cwd: rootDirectory,
    });

    const stdoutBuffers: Buffer[] = [];
    const stderrBuffers: Buffer[] = [];

    child.stdout.on("data", (buffer: Buffer) => stdoutBuffers.push(buffer));
    child.stderr.on("data", (buffer: Buffer) => stderrBuffers.push(buffer));

    child.on("error", (error) => reject(new Error(`Failed to run oxlint: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (signal) {
        const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
        const hint =
          signal === "SIGABRT" ? " (out of memory — try scanning fewer files with --diff)" : "";
        const detail = stderrOutput ? `: ${stderrOutput}` : "";
        reject(new Error(`oxlint was killed by ${signal}${hint}${detail}`));
        return;
      }
      const output = Buffer.concat(stdoutBuffers).toString("utf-8").trim();
      if (!output) {
        const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
        if (stderrOutput) {
          reject(new Error(`Failed to run oxlint: ${stderrOutput}`));
          return;
        }
      }
      resolve(output);
    });
  });

export const runOxlint = async (
  rootDirectory: string,
  hasTypeScript: boolean,
  framework: Framework,
  hasReactCompiler: boolean,
  includePaths?: string[],
  nodeBinaryPath: string = process.execPath,
  customRulesOnly = false,
): Promise<Diagnostic[]> => {
  if (includePaths !== undefined && includePaths.length === 0) {
    return [];
  }

  const configPath = path.join(os.tmpdir(), `react-doctor-oxlintrc-${process.pid}.json`);
  const pluginPath = resolvePluginPath();
  const config = createOxlintConfig({ pluginPath, framework, hasReactCompiler, customRulesOnly });
  const restoreDisableDirectives = neutralizeDisableDirectives(rootDirectory, includePaths);

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const oxlintBinary = resolveOxlintBinary();
    const baseArgs = [oxlintBinary, "-c", configPath, "--format", "json"];

    if (hasTypeScript) {
      baseArgs.push("--tsconfig", "./tsconfig.json");
    }

    const fileBatches =
      includePaths !== undefined ? batchIncludePaths(baseArgs, includePaths) : [["."]];

    const allDiagnostics: Diagnostic[] = [];
    for (const batch of fileBatches) {
      const batchArgs = [...baseArgs, ...batch];
      const stdout = await spawnOxlint(batchArgs, rootDirectory, nodeBinaryPath);
      allDiagnostics.push(...parseOxlintOutput(stdout));
    }

    return allDiagnostics;
  } finally {
    restoreDisableDirectives();
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  }
};
