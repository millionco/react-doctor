import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import {
  __clearParseSourceFileCacheForTests,
  parseSourceFile,
} from "../../utils/parse-source-file.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import { noSpreadAccumulatorInReduce } from "./no-spread-accumulator-in-reduce.js";

vi.mock("../../utils/parse-source-file.js", { spy: true });

const FROZEN_ARRAY_PROVIDER = 'export const labels = Object.freeze(["bronze", "silver", "gold"]);';
const FROZEN_OBJECT_PROVIDER =
  'export const labels = Object.freeze({ dawn: "pink", noon: "blue", dusk: "purple" });';
const IMPORTED_ARRAY_FOLD =
  'import { labels } from "./provider";\nlabels.reduce((result, label) => [...result, label], []);';
const REPEATED_FOLD_COUNT = 120;
let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-frozen-import-"));
  vi.clearAllMocks();
  __clearParseSourceFileCacheForTests();
  resetModuleResolutionCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeProvider = (source: string): string => {
  const providerPath = path.join(temporaryDirectory, "provider.ts");
  fs.writeFileSync(providerPath, source);
  return providerPath;
};

const lintConsumer = (source = IMPORTED_ARRAY_FOLD) => {
  const result = runRule(noSpreadAccumulatorInReduce, source, {
    filename: path.join(temporaryDirectory, "consumer.ts"),
    includeLocations: true,
  });
  expect(result.parseErrors).toEqual([]);
  return result;
};

describe("frozen literal imports in accumulator folds", () => {
  it.each([
    IMPORTED_ARRAY_FOLD,
    'import { labels as medals } from "./provider"; medals.reduceRight((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; const localLabels = labels; const finalLabels = localLabels as readonly string[]; finalLabels.reduce((result, label) => [...result, label], []);',
  ])("keeps exact frozen arrays quiet: %s", (consumer) => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    expect(lintConsumer(consumer).diagnostics).toEqual([]);
  });

  it.each(["keys", "values", "entries"])(
    "keeps Object.%s of an exact frozen object quiet",
    (methodName) => {
      writeProvider(FROZEN_OBJECT_PROVIDER);
      expect(
        lintConsumer(
          `import { labels } from "./provider"; Object.${methodName}(labels).reduce((result, label) => [...result, label], []);`,
        ).diagnostics,
      ).toEqual([]);
    },
  );

  it.each([
    'export const labels = ["bronze", "silver", "gold"] as const;',
    'export const labels: readonly string[] = ["bronze", "silver", "gold"];',
    'export let labels = Object.freeze(["bronze"]);',
    'export var labels = Object.freeze(["bronze"]);',
    'export const labels = Object.seal(["bronze"]);',
    'export const labels = Object.preventExtensions(["bronze"]);',
    "export const labels = Object.freeze(loadLabels());",
    "export const labels = Object.freeze([...externalLabels]);",
    'export const labels = Object.freeze([, "bronze"]);',
    'export const labels = Object.freeze([{ name: "bronze" }]);',
    'export const labels = Object.freeze(["bronze"], externalLabels);',
    "export const labels = Object.freeze(...externalLabels);",
    'export const labels = Object["freeze"](["bronze"]);',
    'export const labels = globalThis.Object.freeze(["bronze"]);',
    'export const labels = Object.freeze?.(["bronze"]);',
    'export const labels = Object.freeze(["bronze"]), other = mutate();',
    'const Object = { freeze: (value) => value }; export const labels = Object.freeze(["bronze"]);',
    'export const Object = Object.freeze(["bronze"]);',
    'Object.freeze = (value) => value; export const labels = Object.freeze(["bronze"]);',
    'Object.defineProperty(Object, "freeze", { value: (value) => value }); export const labels = Object.freeze(["bronze"]);',
    'const nativeObject = Object; nativeObject.freeze = (value) => value; export const labels = Object.freeze(["bronze"]);',
    'export const labels = Object.freeze(["bronze"]); retain(labels);',
    'const mutable = ["bronze"]; export const labels: readonly string[] = mutable; mutable.push("silver");',
    'const labels = Object.freeze(["bronze"]); export { labels };',
    'export { labels } from "./leaf";',
    'export * from "./leaf";',
    'import { labels } from "./leaf"; export { labels };',
    'export const labels = new Proxy(["bronze"], {});',
    "export const labels = Object.freeze([",
  ])("preserves reports for unsupported providers: %s", (provider) => {
    fs.writeFileSync(path.join(temporaryDirectory, "leaf.ts"), FROZEN_ARRAY_PROVIDER);
    writeProvider(provider);
    expect(lintConsumer().diagnostics).toMatchObject([
      { line: 2, column: 33, nodeType: "ArrayExpression" },
    ]);
  });

  it.each([
    'import labels from "./provider"; labels.reduce((result, label) => [...result, label], []);',
    'import * as data from "./provider"; data.labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; retain(labels); labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; const stored = { labels }; labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; const stored = [labels]; labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; const getLabels = () => labels; labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; export { labels }; labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; let alias = labels; alias.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; const alias = labels; alias.push("platinum"); labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; labels[0] = "platinum"; labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; labels.length++; labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; delete labels[0]; labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; Object.assign(labels, extra); labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; Array.prototype.reduce = customReduce; labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; const nativeObject = Object; retain(nativeObject); labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; globalThis.Array = customArray; labels.reduce((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; labels["reduce"]((result, label) => [...result, label], []);',
    'import { labels } from "./provider"; labels.reduce((result, label) => [...result, label], [], ...extra);',
  ])("preserves reports for unsupported consumer references: %s", (consumer) => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    expect(lintConsumer(consumer).diagnostics).toHaveLength(1);
  });

  it("does not confuse a shadowing parameter with the import", () => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    const result = lintConsumer(
      'import { labels } from "./provider"; function fold(labels) { return labels.reduce((result, label) => [...result, label], []); }',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves reports for a shadowed enumeration and unsafe object shapes", () => {
    writeProvider(FROZEN_OBJECT_PROVIDER);
    expect(
      lintConsumer(
        'import { labels } from "./provider"; function fold(Object) { return Object.keys(labels).reduce((result, key) => [...result, key], []); }',
      ).diagnostics,
    ).toHaveLength(1);
    for (const literal of [
      '{ get first() { return "a"; } }',
      '{ [key]: "a" }',
      "{ ...external }",
      '{ __proto__: null, first: "a" }',
    ]) {
      writeProvider(`export const labels = Object.freeze(${literal});`);
      expect(
        lintConsumer(
          'import { labels } from "./provider"; Object.keys(labels).reduce((result, key) => [...result, key], []);',
        ).diagnostics,
      ).toHaveLength(1);
    }
  });

  it("preserves reports for unknown factories and missing exports", () => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    expect(
      lintConsumer(
        'import { loadLabels } from "./provider"; loadLabels().reduce((result, label) => [...result, label], []);',
      ).diagnostics,
    ).toHaveLength(1);
    expect(
      lintConsumer(
        'import { absent } from "./provider"; absent.reduce((result, label) => [...result, label], []);',
      ).diagnostics,
    ).toHaveLength(1);
  });

  it("observes provider edits and newly created providers in later scans", () => {
    expect(lintConsumer().diagnostics).toHaveLength(1);
    writeProvider(FROZEN_ARRAY_PROVIDER);
    resetModuleResolutionCaches();
    expect(lintConsumer().diagnostics).toEqual([]);
    writeProvider("export let labels = loadLabelsFromNetwork();");
    expect(lintConsumer().diagnostics).toHaveLength(1);
  });

  it("records provider content and absent resolution candidates on cold and warm collection", () => {
    const providerPath = writeProvider(FROZEN_ARRAY_PROVIDER);
    const filename = path.join(temporaryDirectory, "consumer.ts");
    const collect = () =>
      collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: IMPORTED_ARRAY_FOLD,
        ruleIds: ["no-spread-accumulator-in-reduce"],
      });
    const cold = collect();
    const warm = collect();
    expect(cold?.contentPaths.has(providerPath)).toBe(true);
    expect(cold?.existencePaths.has(path.join(temporaryDirectory, "provider"))).toBe(true);
    expect(warm).toEqual(cold);
  });

  it("records missing providers so later creation invalidates the dependency fingerprint", () => {
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: path.join(temporaryDirectory, "consumer.ts"),
      sourceText: IMPORTED_ARRAY_FOLD,
      ruleIds: ["no-spread-accumulator-in-reduce"],
    });
    expect(trace?.existencePaths.has(path.join(temporaryDirectory, "provider.ts"))).toBe(true);
  });

  it("parses a provider once when many folds share its import", () => {
    const providerPath = writeProvider(FROZEN_ARRAY_PROVIDER);
    const folds = Array.from(
      { length: REPEATED_FOLD_COUNT },
      (_, index) =>
        `const result${index} = labels.reduce((result, label) => [...result, label], []);`,
    ).join("\n");
    expect(lintConsumer(`import { labels } from "./provider";\n${folds}`).diagnostics).toEqual([]);
    expect(
      vi.mocked(parseSourceFile).mock.calls.filter(([filename]) => filename === providerPath),
    ).toHaveLength(1);
  });
});
