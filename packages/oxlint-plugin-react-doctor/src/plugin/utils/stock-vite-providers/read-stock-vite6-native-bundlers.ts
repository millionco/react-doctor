import { existsSync } from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "../cross-file-probe-recorder.js";
import {
  resolveStockPhysicalEntry,
  type StockPhysicalEntry,
} from "./resolve-stock-physical-entry.js";
import stockNative from "./stock-vite6-native-package-members.json" with { type: "json" };

interface NativeBundlerRuntime {
  readonly platform: string;
  readonly architecture: string;
  readonly libc: "glibc" | "musl" | "unknown";
  readonly esbuildBinaryOverride: boolean;
}

interface NativeBundlerInput {
  readonly projectRoot: string;
  readonly installedCompiler: ReadonlyMap<string, StockPhysicalEntry>;
  readonly runtime: NativeBundlerRuntime;
}

interface NativeBundlerEntries {
  readonly esbuild: StockPhysicalEntry;
  readonly rollup: StockPhysicalEntry;
}

export const readStockVite6NativeBundlers = (
  input: NativeBundlerInput,
): NativeBundlerEntries | null => {
  const { projectRoot, installedCompiler, runtime } = input;
  if (
    runtime.platform !== "linux" ||
    runtime.architecture !== "x64" ||
    runtime.libc !== "glibc" ||
    runtime.esbuildBinaryOverride
  )
    return null;

  const selectedEsbuild = installedCompiler.get("esbuild");
  const selectedRollup = installedCompiler.get("rollup");
  if (!selectedEsbuild || !selectedRollup) return null;
  const nativeRollupDirectory = path.join(selectedRollup.packageDirectory, "dist");
  const rollupMember = "rollup.linux-x64-gnu.node";
  const rollupLocalOverride = path.join(nativeRollupDirectory, rollupMember);
  recordExistenceProbe(rollupLocalOverride);
  if (existsSync(rollupLocalOverride)) return null;

  const esbuild = resolveStockPhysicalEntry({
    projectRoot,
    importerDirectory: path.dirname(selectedEsbuild.entry),
    profile: "node-require",
    specifier: "@esbuild/linux-x64/bin/esbuild",
    contract: stockNative["@esbuild/linux-x64"],
  });
  const rollup = resolveStockPhysicalEntry({
    projectRoot,
    importerDirectory: nativeRollupDirectory,
    profile: "node-require",
    specifier: "@rollup/rollup-linux-x64-gnu",
    contract: stockNative["@rollup/rollup-linux-x64-gnu"],
  });
  return esbuild && rollup ? { esbuild, rollup } : null;
};
