import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AnalyzeReducedMotionSourceInput,
  ProjectMotionEvidence,
} from "../../packages/core/src/check-reduced-motion.js";
import {
  REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV,
  REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV,
} from "../../packages/core/src/constants.js";
import { isRecord } from "../../packages/core/src/utils/is-record.js";

interface ReducedMotionParityCase {
  readonly name: string;
  readonly sources: AnalyzeReducedMotionSourceInput[];
  readonly preserveFileNames: boolean;
  readonly expectedNativeStatus: string;
}

interface MotionResolveInput {
  readonly path: string;
  readonly resolveDir: string;
}

interface MotionBundleContext {
  readonly onResolve: (
    options: { readonly filter: RegExp },
    callback: (input: MotionResolveInput) => { readonly path: string; readonly external: boolean },
  ) => void;
}

interface MotionOracle {
  readonly analyzeReducedMotionSources: (
    sources: AnalyzeReducedMotionSourceInput[],
  ) => ProjectMotionEvidence;
}

const COMPILER_VERSIONS = { "react-doctor": "5.9.3", core: "6.0.3" };
const CANONICAL_MOTION_CASE_COUNT = 381;
const PRIVATE_MOTION_DECLARATION = "const analyzeReducedMotionSources =";
const NATIVE_MOTION_IMPORT =
  'import { runNativeReducedMotionAnalysis } from "./utils/run-native-reduced-motion-analysis.js";';

const readMotionCases = (repositoryRoot: string): ReducedMotionParityCase[] => {
  const fixturePath = path.join(
    repositoryRoot,
    "scripts/native/fixtures/reduced-motion-parity.json",
  );
  const document: unknown = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  assert.ok(isRecord(document) && Array.isArray(document.cases));
  assert.equal(document.cases.length, CANONICAL_MOTION_CASE_COUNT);
  return document.cases.map((entry: unknown) => {
    assert.ok(isRecord(entry) && typeof entry.name === "string" && Array.isArray(entry.sources));
    assert.ok(
      entry.expectedNativeStatus === "exact" || entry.expectedNativeStatus === "unsupported",
    );
    const sources = entry.sources.map((source: unknown) => {
      assert.ok(
        isRecord(source) &&
          typeof source.fileName === "string" &&
          typeof source.sourceText === "string",
      );
      return { fileName: source.fileName, sourceText: source.sourceText };
    });
    return {
      name: entry.name,
      sources,
      preserveFileNames: entry.preserveFileNames === true,
      expectedNativeStatus: entry.expectedNativeStatus,
    };
  });
};

const buildMotionOracle = async (
  repositoryRoot: string,
  temporaryRoot: string,
  compilerPackage: string,
  compilerPath: string,
  useNative: boolean,
): Promise<MotionOracle> => {
  const sourceDirectory = path.join(repositoryRoot, "packages/core/src");
  const sourcePath = path.join(sourceDirectory, "check-reduced-motion.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  assert.equal(source.split(PRIVATE_MOTION_DECLARATION).length, 2);
  assert.equal(source.split(NATIVE_MOTION_IMPORT).length, 2);
  let exposedSource = source.replace(
    PRIVATE_MOTION_DECLARATION,
    `export ${PRIVATE_MOTION_DECLARATION}`,
  );
  if (!useNative) {
    exposedSource = exposedSource.replace(
      NATIVE_MOTION_IMPORT,
      "const runNativeReducedMotionAnalysis = () => null;",
    );
  }
  const repositoryRequire = createRequire(path.join(repositoryRoot, "package.json"));
  const bundler: unknown = createRequire(repositoryRequire.resolve("tsx/package.json"))("esbuild");
  assert.ok(isRecord(bundler) && typeof bundler.build === "function");
  const outputPath = path.join(
    temporaryRoot,
    `motion-${compilerPackage}-${useNative ? "native" : "canonical"}.mjs`,
  );
  await bundler.build({
    stdin: {
      contents: exposedSource,
      loader: "ts",
      sourcefile: sourcePath,
      resolveDir: sourceDirectory,
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: outputPath,
    logLevel: "silent",
    plugins: [
      {
        name: "pin-motion-runtime-dependencies",
        setup: (build: MotionBundleContext): void => {
          build.onResolve({ filter: /^[^./]/ }, (input) => {
            if (input.path === "typescript")
              return { path: pathToFileURL(compilerPath).href, external: true };
            if (isBuiltin(input.path)) return { path: input.path, external: true };
            const resolvedPath = createRequire(path.join(input.resolveDir, "package.json")).resolve(
              input.path,
            );
            return { path: pathToFileURL(resolvedPath).href, external: true };
          });
        },
      },
    ],
  });
  const bundle = fs.readFileSync(outputPath, "utf8");
  assert.ok(
    bundle.includes(JSON.stringify(pathToFileURL(compilerPath).href)),
    "Motion bundle omitted the pinned compiler",
  );
  assert.ok(
    !/from ["']typescript["']/.test(bundle),
    "Motion bundle contains an unpinned compiler import",
  );
  const oracle: unknown = await import(pathToFileURL(outputPath).href);
  assert.ok(isRecord(oracle) && typeof oracle.analyzeReducedMotionSources === "function");
  const analyze = oracle.analyzeReducedMotionSources;
  return {
    analyzeReducedMotionSources: (sources) => {
      const evidence: unknown = analyze(sources);
      assert.ok(
        isRecord(evidence) &&
          typeof evidence.hasMotionUse === "boolean" &&
          typeof evidence.hasReducedMotionHandling === "boolean",
      );
      assert.deepEqual(Object.keys(evidence).sort(), ["hasMotionUse", "hasReducedMotionHandling"]);
      return {
        hasMotionUse: evidence.hasMotionUse,
        hasReducedMotionHandling: evidence.hasReducedMotionHandling,
      };
    },
  };
};

export const verifyNativeReducedMotionParity = async (
  bindingPath: string,
  temporaryRoot: string,
  repositoryRoot: string,
): Promise<void> => {
  const require = createRequire(
    new URL("./verify-native-reduced-motion-parity.cjs", import.meta.url),
  );
  const binding: unknown = require(bindingPath);
  assert.ok(
    isRecord(binding) && typeof binding.analyzeReactDoctorReducedMotion === "function",
    "Native binding omitted reduced motion analysis",
  );
  const nativeAnalyze = binding.analyzeReactDoctorReducedMotion;
  const cases = readMotionCases(repositoryRoot);
  const previousBindingPath = process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV];
  const previousRequired = process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV];
  process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV] = bindingPath;
  process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] = "1";
  try {
    for (const [compilerPackage, expectedVersion] of Object.entries(COMPILER_VERSIONS)) {
      const compilerRequire = createRequire(
        path.join(repositoryRoot, "packages", compilerPackage, "package.json"),
      );
      const compilerPath = compilerRequire.resolve("typescript");
      const compiler: unknown = compilerRequire(compilerPath);
      assert.ok(
        isRecord(compiler) && compiler.version === expectedVersion,
        `${compilerPackage}: expected TypeScript ${expectedVersion}`,
      );
      const canonical = await buildMotionOracle(
        repositoryRoot,
        temporaryRoot,
        compilerPackage,
        compilerPath,
        false,
      );
      const actual = await buildMotionOracle(
        repositoryRoot,
        temporaryRoot,
        compilerPackage,
        compilerPath,
        true,
      );
      let directExact = 0;
      let directUnsupported = 0;
      let directMotionFiring = 0;
      let directHandlingFiring = 0;
      let runtimeNativeCalls = 0;
      binding.analyzeReactDoctorReducedMotion = (input: string): unknown => {
        runtimeNativeCalls++;
        return nativeAnalyze(input);
      };
      for (const [caseIndex, parityCase] of cases.entries()) {
        const sources = parityCase.sources.map((source) => ({
          ...source,
          fileName: parityCase.preserveFileNames
            ? source.fileName
            : path.join(temporaryRoot, `case-${caseIndex}`, source.fileName),
        }));
        const label = `${compilerPackage}: ${parityCase.name}`;
        const expected = canonical.analyzeReducedMotionSources(sources);
        const outputJson: unknown = nativeAnalyze(JSON.stringify(sources));
        assert.equal(typeof outputJson, "string", `${label}: native output must be JSON`);
        const output: unknown = JSON.parse(String(outputJson));
        assert.ok(isRecord(output), `${label}: native output must be an object`);
        if (Object.hasOwn(output, "unsupported")) {
          assert.deepEqual(Object.keys(output), ["unsupported"], label);
          assert.ok(
            Array.isArray(output.unsupported) &&
              output.unsupported.length > 0 &&
              output.unsupported.every(
                (reason: unknown) => typeof reason === "string" && reason.length > 0,
              ),
            label,
          );
          directUnsupported++;
          assert.ok(
            process.platform === "win32" || parityCase.expectedNativeStatus === "unsupported",
            `${label}: native firing coverage regressed to fallback`,
          );
        } else {
          assert.notEqual(
            process.platform,
            "win32",
            "Windows must use the explicit path-semantics fallback",
          );
          assert.equal(
            parityCase.expectedNativeStatus,
            "exact",
            `${label}: unsupported boundary changed`,
          );
          assert.deepEqual(output, expected, `${label}: direct native evidence differs`);
          directExact++;
          if (expected.hasMotionUse) directMotionFiring++;
          if (expected.hasReducedMotionHandling) directHandlingFiring++;
        }
        assert.deepEqual(
          actual.analyzeReducedMotionSources(sources),
          expected,
          `${label}: required-mode runtime or canonical fallback differs`,
        );
      }
      assert.ok(runtimeNativeCalls > 0, "Required-mode runtime never called the native API");
      assert.ok(directUnsupported > 0, "Explicit unsupported fallback was not exercised");
      if (process.platform !== "win32") {
        assert.ok(
          directExact > 0 && directMotionFiring > 0 && directHandlingFiring > 0,
          "Native motion and handling controls must fire",
        );
      }
      const surrogateSources = [
        {
          fileName: path.join(temporaryRoot, "surrogate.tsx"),
          sourceText:
            "// \ud800\nimport { motion } from 'framer-motion'; export const View = () => <motion.div />;",
        },
      ];
      const callsBeforeSurrogate = runtimeNativeCalls;
      assert.deepEqual(
        actual.analyzeReducedMotionSources(surrogateSources),
        canonical.analyzeReducedMotionSources(surrogateSources),
        "Lone surrogate must preserve canonical fallback in required mode",
      );
      assert.equal(
        runtimeNativeCalls,
        callsBeforeSurrogate,
        "Lone surrogate crossed the native UTF-8 boundary",
      );
      const firingSources = [
        {
          fileName: path.join(temporaryRoot, "firing.tsx"),
          sourceText:
            "import { motion } from 'framer-motion'; export const View = () => <motion.div />;",
        },
      ];
      binding.analyzeReactDoctorReducedMotion = (): string => '{"unsupported":[]}';
      assert.throws(
        () => actual.analyzeReducedMotionSources(firingSources),
        /invalid result/,
        "Malformed unsupported output must fail required mode",
      );
      binding.analyzeReactDoctorReducedMotion = (): never => {
        throw new Error("Handwritten native motion failure");
      };
      assert.throws(
        () => actual.analyzeReducedMotionSources(firingSources),
        /analysis failed/,
        "Native exception must fail required mode",
      );
      binding.analyzeReactDoctorReducedMotion = nativeAnalyze;
      const compilerSha256 = createHash("sha256")
        .update(fs.readFileSync(compilerPath))
        .digest("hex");
      process.stdout.write(
        `Native reduced motion parity: TypeScript ${expectedVersion}, ${cases.length} cases, ${directExact} direct exact, ${directUnsupported} explicit unsupported, ${runtimeNativeCalls} runtime native calls; required fallback/failures exact. Compiler SHA256 ${compilerSha256}.\n`,
      );
    }
  } finally {
    binding.analyzeReactDoctorReducedMotion = nativeAnalyze;
    if (previousBindingPath === undefined)
      delete process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV];
    else process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV] = previousBindingPath;
    if (previousRequired === undefined) delete process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV];
    else process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] = previousRequired;
  }
};
