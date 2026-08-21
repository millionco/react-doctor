import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromRepository = createRequire(path.join(repositoryRoot, "package.json"));
const nativeRules = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "native", "oxlint", "upstream.json"), "utf8"),
).nativeRules;
const argumentsList = process.argv.slice(2);
const readOption = (name) => {
  const optionIndex = argumentsList.indexOf(name);
  if (optionIndex === -1) return null;
  const optionValue = argumentsList[optionIndex + 1];
  if (!optionValue || optionValue.startsWith("--")) throw new Error(`${name} requires a value`);
  return optionValue;
};
const bindingDirectory = readOption("--directory");
const corpusDirectory = readOption("--corpus");
const configuredBindingPath =
  readOption("--binding") ?? process.env.REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH;
const nativeBindingCandidates = bindingDirectory
  ? fs
      .readdirSync(path.resolve(bindingDirectory))
      .filter((fileName) => fileName.endsWith(".node"))
      .map((fileName) => path.join(path.resolve(bindingDirectory), fileName))
  : configuredBindingPath
    ? [configuredBindingPath]
    : [];
if (nativeBindingCandidates.length > 1) {
  throw new Error(`expected one native binding, received ${nativeBindingCandidates.length}`);
}
const nativeBindingPath = nativeBindingCandidates[0];
if (!nativeBindingPath)
  throw new Error("pass --binding, --directory, or set the native binding env");
if (!fs.existsSync(nativeBindingPath))
  throw new Error(`native binding not found: ${nativeBindingPath}`);

const oxlintMainPath = requireFromRepository.resolve("oxlint");
const oxlintBinaryPath = path.join(
  path.resolve(path.dirname(oxlintMainPath), ".."),
  "bin",
  "oxlint",
);
const pluginPath = requireFromRepository.resolve("oxlint-plugin-react-doctor");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-native-parity-"));
const fixturePath = path.join(temporaryDirectory, "fixture.tsx");
const stockConfigPath = path.join(temporaryDirectory, "stock.json");
const nativeConfigPath = path.join(temporaryDirectory, "native.json");
const EXPECTED_DIAGNOSTIC_COUNTS = {
  "jsx-no-duplicate-props": 1,
  "nextjs-no-vercel-og-import": 1,
  "no-children-prop": 2,
  "no-danger": 3,
  "no-document-write": 8,
  "no-moment": 1,
  "no-namespace": 2,
  "no-react-children": 2,
  "preact-no-react-hooks-import": 2,
  "rn-bottom-sheet-prefer-native": 1,
  "rn-no-deprecated-modules": 1,
  "rn-no-legacy-expo-packages": 1,
  "rn-no-panresponder": 1,
  "rn-prefer-pressable": 1,
  "rn-prefer-reanimated": 2,
  "use-lazy-motion": 1,
};
const BENCHMARK_FILE_COUNT = 100;
const BENCHMARK_CALL_COUNT_PER_FILE = 500;
const BENCHMARK_SAMPLE_COUNT = 5;
const OXLINT_OUTPUT_MAX_BYTES = 256 * 1024 * 1024;
const DISABLED_RULE_CATEGORIES = {
  correctness: "off",
  nursery: "off",
  pedantic: "off",
  perf: "off",
  restriction: "off",
  style: "off",
  suspicious: "off",
};
const shouldBenchmark = argumentsList.includes("--benchmark");
const fixture = `
import moment from "moment";
import type { Moment } from "moment";
import { ImageResponse } from "@vercel/og";
import React, { Children, useEffect, useState, Component } from "react";
import type { useMemo as PreactTypeOnlyHook } from "react";
import RawBottomSheet from "react-native-raw-bottom-sheet";
import { Audio } from "expo-av/build/Audio";
import {
  Animated,
  AsyncStorage,
  LayoutAnimation,
  PanResponder as PR,
  TouchableOpacity,
  type WebView,
} from "react-native";
import { motion, type MotionConfig } from "framer-motion";
document.write("a");
document.writeln("b");
document["write"]("c");
document[\`writeln\`]("d");
document?.write("e");
document!.write("f");
(document as Document)["write"]("g");
(document satisfies Document).writeln("h");
document[method]("safe");
stream.write("safe");
{ const document = { write() {} }; document.write("safe"); }
const duplicateProps = <Widget value="first" value="second" />;
const namespaced = <svg:path />;
React.createElement("svg:path");
const danger = <div dangerouslySetInnerHTML={{ __html: markup }} />;
React.createElement("div", { dangerouslySetInnerHTML: { __html: markup } });
const suppressedOnlyForReact =
  // eslint-disable-next-line react/no-danger
  <div dangerouslySetInnerHTML={{ __html: markup }} />;
const suppressedReactDoctor =
  // eslint-disable-next-line react-doctor/no-danger
  <div dangerouslySetInnerHTML={{ __html: markup }} />;
const childrenProp = <Widget children="hidden" />;
React.createElement(Widget, { children: "hidden" });
Children.map(children, child => child);
React.Children.only(children);
`;

const normalizeDiagnostics = (diagnostics) =>
  diagnostics
    .filter(
      (diagnostic) =>
        typeof diagnostic.code === "string" &&
        nativeRules.some((nativeRuleId) => diagnostic.code.includes(`(${nativeRuleId})`)),
    )
    .map((diagnostic) => ({
      code: diagnostic.code.replace("react-doctor-native", "react-doctor"),
      filename: path.relative(repositoryRoot, path.resolve(repositoryRoot, diagnostic.filename)),
      message: diagnostic.message,
      severity: diagnostic.severity,
      labels: diagnostic.labels,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const countDiagnosticsByRule = (diagnostics) => {
  const counts = Object.fromEntries(nativeRules.map((nativeRuleId) => [nativeRuleId, 0]));
  for (const diagnostic of diagnostics) {
    const ruleId = nativeRules.find((candidateRuleId) =>
      diagnostic.code.includes(`(${candidateRuleId})`),
    );
    if (ruleId) counts[ruleId] += 1;
  }
  return counts;
};

const runOxlint = (configPath, environment, targetPath = fixturePath) => {
  const startedAt = performance.now();
  const result = spawnSync(
    process.execPath,
    [oxlintBinaryPath, "-c", configPath, "--format", "json", targetPath],
    {
      cwd: repositoryRoot,
      env: environment,
      encoding: "utf8",
      maxBuffer: OXLINT_OUTPUT_MAX_BYTES,
    },
  );
  if (result.error) throw result.error;
  if (!result.stdout) {
    throw new Error(result.stderr || `oxlint exited with status ${result.status}`);
  }
  const parsed = JSON.parse(result.stdout);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || `oxlint exited with status ${result.status}`);
  }
  return {
    durationMs: performance.now() - startedAt,
    diagnostics: normalizeDiagnostics(parsed.diagnostics),
  };
};

try {
  fs.writeFileSync(fixturePath, fixture);
  fs.writeFileSync(
    stockConfigPath,
    JSON.stringify({
      categories: DISABLED_RULE_CATEGORIES,
      plugins: [],
      jsPlugins: [pluginPath],
      rules: Object.fromEntries(
        nativeRules.map((nativeRuleId) => [`react-doctor/${nativeRuleId}`, "warn"]),
      ),
    }),
  );
  fs.writeFileSync(
    nativeConfigPath,
    JSON.stringify({
      categories: DISABLED_RULE_CATEGORIES,
      plugins: ["react-doctor-native"],
      jsPlugins: [],
      rules: Object.fromEntries(
        nativeRules.map((nativeRuleId) => [`react-doctor-native/${nativeRuleId}`, "warn"]),
      ),
    }),
  );
  const stockDiagnostics = runOxlint(stockConfigPath, process.env).diagnostics;
  const nativeEnvironment = {
    ...process.env,
    NAPI_RS_NATIVE_LIBRARY_PATH: path.resolve(nativeBindingPath),
  };
  const nativeDiagnostics = runOxlint(nativeConfigPath, nativeEnvironment).diagnostics;
  const stockDiagnosticCounts = countDiagnosticsByRule(stockDiagnostics);
  if (JSON.stringify(stockDiagnosticCounts) !== JSON.stringify(EXPECTED_DIAGNOSTIC_COUNTS)) {
    throw new Error(
      `unexpected JavaScript diagnostic coverage\nexpected=${JSON.stringify(EXPECTED_DIAGNOSTIC_COUNTS, null, 2)}\nreceived=${JSON.stringify(stockDiagnosticCounts, null, 2)}`,
    );
  }
  if (JSON.stringify(nativeDiagnostics) !== JSON.stringify(stockDiagnostics)) {
    throw new Error(
      `native parity failed\nstock=${JSON.stringify(stockDiagnostics, null, 2)}\nnative=${JSON.stringify(nativeDiagnostics, null, 2)}`,
    );
  }
  process.stdout.write(`Native parity passed for ${stockDiagnostics.length} diagnostics.\n`);

  if (corpusDirectory) {
    const resolvedCorpusDirectory = path.resolve(corpusDirectory);
    const corpusRepositories = fs
      .readdirSync(resolvedCorpusDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
    if (corpusRepositories.length === 0) {
      throw new Error(`no repositories found in corpus: ${resolvedCorpusDirectory}`);
    }
    let corpusDiagnosticCount = 0;
    for (const repositoryName of corpusRepositories) {
      const repositoryPath = path.join(resolvedCorpusDirectory, repositoryName);
      const repositoryStockDiagnostics = runOxlint(
        stockConfigPath,
        process.env,
        repositoryPath,
      ).diagnostics;
      const repositoryNativeDiagnostics = runOxlint(
        nativeConfigPath,
        nativeEnvironment,
        repositoryPath,
      ).diagnostics;
      if (
        JSON.stringify(repositoryNativeDiagnostics) !== JSON.stringify(repositoryStockDiagnostics)
      ) {
        const nativeDiagnosticKeys = new Set(repositoryNativeDiagnostics.map(JSON.stringify));
        const stockDiagnosticKeys = new Set(repositoryStockDiagnostics.map(JSON.stringify));
        const stockOnlyDiagnostic = repositoryStockDiagnostics.find(
          (diagnostic) => !nativeDiagnosticKeys.has(JSON.stringify(diagnostic)),
        );
        const nativeOnlyDiagnostic = repositoryNativeDiagnostics.find(
          (diagnostic) => !stockDiagnosticKeys.has(JSON.stringify(diagnostic)),
        );
        throw new Error(
          `native corpus parity failed for ${repositoryName}\nstock count=${repositoryStockDiagnostics.length}\nnative count=${repositoryNativeDiagnostics.length}\nstock only=${JSON.stringify(stockOnlyDiagnostic, null, 2)}\nnative only=${JSON.stringify(nativeOnlyDiagnostic, null, 2)}`,
        );
      }
      corpusDiagnosticCount += repositoryStockDiagnostics.length;
    }
    process.stdout.write(
      `Native corpus parity passed for ${corpusRepositories.length} repositories and ${corpusDiagnosticCount} diagnostics.\n`,
    );
  }

  if (shouldBenchmark) {
    const benchmarkDirectory = path.join(temporaryDirectory, "benchmark");
    fs.mkdirSync(benchmarkDirectory);
    const benchmarkSource = `${Array.from(
      { length: BENCHMARK_CALL_COUNT_PER_FILE },
      (_unused, index) => `stream.write(value${index});`,
    ).join("\n")}\n`;
    for (let fileIndex = 0; fileIndex < BENCHMARK_FILE_COUNT; fileIndex += 1) {
      fs.writeFileSync(path.join(benchmarkDirectory, `fixture-${fileIndex}.ts`), benchmarkSource);
    }
    runOxlint(stockConfigPath, process.env, benchmarkDirectory);
    runOxlint(nativeConfigPath, nativeEnvironment, benchmarkDirectory);
    const stockDurationsMs = [];
    const nativeDurationsMs = [];
    for (let sampleIndex = 0; sampleIndex < BENCHMARK_SAMPLE_COUNT; sampleIndex += 1) {
      const shouldRunNativeFirst = sampleIndex % 2 === 1;
      if (shouldRunNativeFirst) {
        nativeDurationsMs.push(
          runOxlint(nativeConfigPath, nativeEnvironment, benchmarkDirectory).durationMs,
        );
        stockDurationsMs.push(
          runOxlint(stockConfigPath, process.env, benchmarkDirectory).durationMs,
        );
      } else {
        stockDurationsMs.push(
          runOxlint(stockConfigPath, process.env, benchmarkDirectory).durationMs,
        );
        nativeDurationsMs.push(
          runOxlint(nativeConfigPath, nativeEnvironment, benchmarkDirectory).durationMs,
        );
      }
    }
    const median = (values) => {
      const sortedValues = [...values].sort((left, right) => left - right);
      return sortedValues[Math.floor(sortedValues.length / 2)];
    };
    const stockMedianMs = median(stockDurationsMs);
    const nativeMedianMs = median(nativeDurationsMs);
    const speedupPercent = ((stockMedianMs - nativeMedianMs) / stockMedianMs) * 100;
    process.stdout.write(
      `Benchmark p50: JavaScript ${stockMedianMs.toFixed(1)} ms, native ${nativeMedianMs.toFixed(1)} ms, ${speedupPercent.toFixed(1)}% faster.\n`,
    );
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
