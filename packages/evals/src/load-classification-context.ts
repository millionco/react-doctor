import { createHash } from "node:crypto";
import { posix } from "node:path";

import { z } from "zod";

import type { ClassificationCandidate } from "./classification-schema.js";
import {
  CLASSIFICATION_MAX_CODE_CHARACTERS,
  CLASSIFICATION_MAX_CONFIG_CHARACTERS,
  CLASSIFICATION_MAX_CONFIG_DEPTH,
  CLASSIFICATION_MAX_CONFIG_FILES,
} from "./constants.js";
import type { ClassificationSourceLoader } from "./prepare-classification.js";
import { PinnedSourceMissingError, sourcePath } from "./prepare-classification.js";

const configSchema = z.looseObject({
  extends: z.string().optional(),
  compilerOptions: z
    .object({
      jsx: z.string().optional(),
      jsxFactory: z.string().optional(),
      jsxFragmentFactory: z.string().optional(),
      jsxImportSource: z.string().optional(),
      noEmit: z.boolean().optional(),
      emitDeclarationOnly: z.boolean().optional(),
      allowJs: z.boolean().optional(),
      outDir: z.string().optional(),
    })
    .optional(),
  references: z.unknown().optional(),
});

const unsupportedBuildConfigs = [
  ".babelrc",
  ".babelrc.json",
  ".babelrc.js",
  ".babelrc.cjs",
  "babel.config.json",
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.mjs",
  ".swcrc",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "webpack.config.js",
];

export const loadClassificationBuildEvidence = async (
  candidate: ClassificationCandidate,
  loadSource: ClassificationSourceLoader,
): Promise<NonNullable<ClassificationCandidate["buildEvidence"]>> => {
  const evidence: NonNullable<ClassificationCandidate["buildEvidence"]> = {
    jsxRuntime: "unknown",
    files: [],
  };
  let buildScript: string | undefined;
  let packageDirectory: string | undefined;
  const loaded = new Map<string, string | null>();
  const fileIndexes = new Map<string, number>();
  const load = async (path: string): Promise<string | null> => {
    const safePath = sourcePath(".", path);
    if (loaded.has(safePath)) return loaded.get(safePath) ?? null;
    if (loaded.size >= CLASSIFICATION_MAX_CONFIG_FILES)
      throw new Error("Build evidence file budget exceeded");
    loaded.set(safePath, null);
    let content: string;
    try {
      content = await loadSource(candidate.repository, safePath);
    } catch (error) {
      if (error instanceof PinnedSourceMissingError) {
        evidence.files.push({ path: safePath, status: "absent" });
        return null;
      }
      evidence.files.push({ path: safePath, status: "unavailable" });
      throw new Error("Pinned build evidence is unavailable");
    }
    if (content.length > CLASSIFICATION_MAX_CONFIG_CHARACTERS)
      throw new Error("Build evidence exceeds the context limit");
    fileIndexes.set(safePath, evidence.files.length);
    evidence.files.push({
      path: safePath,
      status: "present",
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    loaded.set(safePath, content);
    return content;
  };
  const resolving = new Set<string>();
  const resolveConfig = async (
    path: string,
    depth = 0,
  ): Promise<z.infer<typeof configSchema>["compilerOptions"]> => {
    if (depth >= CLASSIFICATION_MAX_CONFIG_DEPTH || resolving.has(path))
      throw new Error("Config inheritance is cyclic or too deep");
    resolving.add(path);
    const content = await load(path);
    if (content === null) throw new Error("Inherited config is missing");
    const config = configSchema.parse(JSON.parse(content));
    if (config.references) throw new Error("Project references require build selection evidence");
    if (config.files || config.include || config.exclude)
      throw new Error("Explicit compiler file selection is unsupported");
    if (config.compilerOptions?.outDir) {
      const outputDirectory = sourcePath(posix.dirname(path), config.compilerOptions.outDir);
      const relativeSource = posix.relative(outputDirectory, candidate.filePath);
      if (relativeSource !== ".." && !relativeSource.startsWith("../"))
        throw new Error("Source is excluded by the compiler output directory");
    }
    const fileIndex = fileIndexes.get(path);
    const file = fileIndex === undefined ? undefined : evidence.files[fileIndex];
    if (file)
      file.facts = {
        compilerOptions: config.compilerOptions ?? {},
        extends: config.extends ?? null,
      };
    let inherited: z.infer<typeof configSchema>["compilerOptions"];
    if (config.extends) {
      if (!config.extends.startsWith("."))
        throw new Error("Package or absolute config inheritance is unsupported");
      let parent = sourcePath(posix.dirname(path), config.extends);
      if (!posix.extname(parent)) parent += ".json";
      inherited = await resolveConfig(parent, depth + 1);
    }
    resolving.delete(path);
    return { ...inherited, ...config.compilerOptions };
  };
  try {
    let directory = posix.dirname(sourcePath(".", candidate.filePath));
    let nearestConfig: string | undefined;
    let depth = 0;
    while (true) {
      if (++depth > CLASSIFICATION_MAX_CONFIG_DEPTH)
        throw new Error("Build evidence ancestor limit exceeded");
      for (const name of ["tsconfig.json", "jsconfig.json"]) {
        const path = sourcePath(directory, name);
        if ((await load(path)) !== null && !nearestConfig) nearestConfig = path;
      }
      const manifestPath = sourcePath(directory, "package.json");
      const manifestText = await load(manifestPath);
      if (manifestText !== null) {
        const manifest = z
          .object({
            babel: z.unknown().optional(),
            scripts: z.record(z.string(), z.string()).optional(),
          })
          .parse(JSON.parse(manifestText));
        const fileIndex = fileIndexes.get(manifestPath);
        const file = fileIndex === undefined ? undefined : evidence.files[fileIndex];
        if (file)
          file.facts = { scripts: manifest.scripts ?? {}, hasBabel: manifest.babel !== undefined };
        if (manifest.babel !== undefined)
          throw new Error("Package Babel configuration requires transform resolution");
        if (manifest.scripts?.prebuild || manifest.scripts?.postbuild)
          throw new Error("Build lifecycle scripts require transform resolution");
        if (packageDirectory === undefined) {
          packageDirectory = directory;
          buildScript = manifest.scripts?.build;
        }
      }
      for (const name of unsupportedBuildConfigs) {
        if ((await load(sourcePath(directory, name))) !== null)
          throw new Error("Custom build configuration requires transform resolution");
      }
      if (directory === ".") break;
      directory = posix.dirname(directory);
    }
    if (!nearestConfig) throw new Error("No pinned JSX compiler configuration");
    const compilerCommand = buildScript?.match(/^tsc(?:\s+(?:-p|--project)\s+([./\w-]+))?$/);
    if (!compilerCommand || packageDirectory === undefined)
      throw new Error("The active build command cannot be resolved to the JSX compiler config");
    let buildConfig = sourcePath(packageDirectory, compilerCommand[1] ?? "tsconfig.json");
    if (!posix.extname(buildConfig)) buildConfig = sourcePath(buildConfig, "tsconfig.json");
    if (buildConfig !== nearestConfig)
      throw new Error("The build uses a different compiler configuration");
    const options = await resolveConfig(nearestConfig);
    if (options?.noEmit || options?.emitDeclarationOnly)
      throw new Error("Typechecking-only configuration does not establish the JSX runtime");
    if (!candidate.filePath.endsWith(".tsx") && !options?.allowJs)
      throw new Error("Compiler coverage of this source extension is unknown");
    if (options?.jsxFactory || options?.jsxFragmentFactory)
      throw new Error("Custom JSX factories require transform resolution");
    evidence.jsxImportSource = options?.jsxImportSource;
    if (options?.jsx === "react-jsx" || options?.jsx === "react-jsxdev")
      evidence.jsxRuntime = "automatic";
    else if (options?.jsx === "react") evidence.jsxRuntime = "classic";
    else throw new Error("JSX preserve, missing, or unsupported modes do not establish a runtime");
  } catch (error) {
    evidence.jsxRuntime = "unknown";
    evidence.issue =
      error instanceof SyntaxError || error instanceof z.ZodError
        ? "Non-JSON or unsupported build configuration"
        : error instanceof Error
          ? error.message
          : "Unsupported build evidence";
  }
  return evidence;
};

export const loadClassificationContext = async (
  candidate: ClassificationCandidate,
  loadSource: ClassificationSourceLoader,
): Promise<ClassificationCandidate> => {
  let code = "";
  let contextIssue: string | undefined;
  try {
    code = await loadSource(candidate.repository, candidate.filePath);
    if (code.length > CLASSIFICATION_MAX_CODE_CHARACTERS) {
      code = "";
      contextIssue = "Source exceeds the classification context limit";
    } else if (
      !code.trim() ||
      (candidate.detected && (!candidate.line || candidate.line > code.split("\n").length))
    ) {
      contextIssue = "Source is empty or the diagnostic has no valid source line";
    }
  } catch {
    contextIssue = "Pinned source is unavailable";
  }
  const buildEvidence = candidate.rule.requiredEvidence?.includes("jsx-runtime")
    ? await loadClassificationBuildEvidence(candidate, loadSource)
    : undefined;
  contextIssue ??= candidate.rule.contractIssue;
  if (
    candidate.rule.requiredEvidence?.includes("verified-contract") &&
    !candidate.rule.contractHash
  ) {
    contextIssue ??= "Canonical rule contract is unverified";
  }
  if (buildEvidence?.jsxRuntime === "unknown")
    contextIssue ??= buildEvidence.issue ?? "JSX runtime is unknown";
  return { ...candidate, code, buildEvidence, contextIssue, contextComplete: !contextIssue };
};
