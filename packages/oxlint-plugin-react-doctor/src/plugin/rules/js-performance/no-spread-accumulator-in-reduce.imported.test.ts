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
import { getFiniteStaticStringValues } from "../../utils/get-finite-static-string-values.js";
import {
  FROZEN_COLLECTION_PROPERTY_KEY_MAX_EXPRESSIONS,
  FROZEN_COLLECTION_PROPERTY_KEY_MAX_CHARS,
} from "../../constants/thresholds.js";

vi.mock("../../utils/parse-source-file.js", { spy: true });
vi.mock("../../utils/get-finite-static-string-values.js", { spy: true });

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

  it("preserves reports after a destructured prototype write", () => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    expect(
      lintConsumer(`import { labels } from "./provider";
        const { constructor: { prototype: arrayPrototype } } = [];
        ({ reduce: arrayPrototype.reduce } = {
          reduce(callback, seed) {
            for (const item of externalItems) seed = callback(seed, item);
            return seed;
          },
        });
        labels.reduce((result, label) => [...result, label], []);`).diagnostics,
    ).toHaveLength(1);
  });

  it("preserves reports when a legacy accessor replaces the inherited reducer", () => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    expect(
      lintConsumer(`import { labels } from "./provider";
        const { constructor: { prototype: arrayPrototype } } = [];
        export function fold(externalItems) {
          arrayPrototype.__defineGetter__("reduce", () => function(callback, seed) {
            for (const item of externalItems) seed = callback(seed, item);
            return seed;
          });
          return labels.reduce((result, label) => [...result, label], []);
        }`).diagnostics,
    ).toHaveLength(1);
  });

  it.each([
    'arrayPrototype.__defineSetter__("reduce", () => {});',
    'arrayPrototype["__defineGetter__"]("reduce", () => replacement);',
    'arrayPrototype[`__defineSetter__`]("reduce", () => {});',
    'const method = "__defineGetter__"; arrayPrototype[method]("reduce", () => replacement);',
    'const method = `__defineSetter__`; arrayPrototype[method]("reduce", () => {});',
    'const install = arrayPrototype.__defineGetter__; install.call(arrayPrototype, "reduce", () => replacement);',
    'const { __defineGetter__: install } = arrayPrototype; install.call(arrayPrototype, "reduce", () => replacement);',
    'const { __defineSetter__: install } = arrayPrototype; install.call(arrayPrototype, "reduce", () => {});',
    'const { __defineGetter__: install } = arrayPrototype; const alias = install; alias.apply(arrayPrototype, ["reduce", () => replacement]);',
    'const method = "__defineGetter__"; const { [method]: install } = arrayPrototype; install.call(arrayPrototype, "reduce", () => replacement);',
    "export const { __defineGetter__: install } = arrayPrototype;",
    'arrayPrototype["__define" + "Getter__"]("reduce", () => replacement);',
    'const method = "__define" + "Setter__"; arrayPrototype[method]("reduce", () => {});',
    'const method = "__define" + "Getter__"; const { [method]: install } = arrayPrototype; install.call(arrayPrototype, "reduce", () => replacement);',
    'const method = choose ? "__defineGetter__" : "__defineGetter__"; arrayPrototype[method]("reduce", () => replacement);',
    'let method = "__defineGetter__"; arrayPrototype[method]("reduce", () => replacement);',
    'var method = "__defineSetter__"; arrayPrototype[method]("reduce", () => {});',
    'const method = choose && "__defineGetter__"; arrayPrototype[method]("reduce", () => replacement);',
    'const method = choose || "__defineSetter__"; arrayPrototype[method]("reduce", () => {});',
    'const method = choose ?? "__defineGetter__"; arrayPrototype[method]("reduce", () => replacement);',
    'arrayPrototype[(ignored, "__defineGetter__")]("reduce", () => replacement);',
    'let method; arrayPrototype[(method = "__defineGetter__")]("reduce", () => replacement);',
    'const method = choose ? opaque : "__defineGetter__"; arrayPrototype[method]("reduce", () => replacement);',
    'const method = choose ? "__defineGetter__" : opaque; arrayPrototype[method]("reduce", () => replacement);',
    'const left = a ? "a" : b ? "b" : c ? "c" : "__define"; const right = d ? "0" : e ? "1" : f ? "2" : g ? "3" : h ? "4" : i ? "5" : j ? "6" : k ? "7" : "Getter__"; arrayPrototype[left + right]("reduce", () => replacement);',
  ])("preserves reports for visible legacy accessor capabilities: %s", (installation) => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    expect(
      lintConsumer(`import { labels } from "./provider";
        const { constructor: { prototype: arrayPrototype } } = [];
        const replacement = (callback, seed) => {
          for (const item of externalItems) seed = callback(seed, item);
          return seed;
        };
        ${installation}
        labels.reduce((result, label) => [...result, label], []);`).diagnostics,
    ).toHaveLength(1);
  });

  it.each([
    "const { __defineGetter__: read } = arrayPrototype;",
    "const { __defineGetter__: read } = arrayPrototype; typeof read;",
    "const { __defineSetter__: read } = arrayPrototype; void read;",
    "const { __defineGetter__: read } = arrayPrototype; const alias = read; alias;",
    "const { __defineGetter__: read = record.value } = input; typeof read;",
    "const { [record.key]: read = record.value } = input;",
  ])("keeps passive destructured accessor reads quiet: %s", (read) => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    expect(
      lintConsumer(`import { labels } from "./provider";
        const { constructor: { prototype: arrayPrototype } } = [];
        ${read}
        labels.reduce((result, label) => [...result, label], []);`).diagnostics,
    ).toEqual([]);
  });

  it.each([
    "unrelated[readMethod()]();",
    "const method = readMethod(); unrelated[method]();",
    'unrelated["ordinary" + "Method"]();',
    "const { [unrelated[readKey()]]: value } = input;",
    'const method = choose ? opaque : "ordinary"; unrelated[method]();',
    'const method = opaque || "ordinary"; unrelated[method]();',
    'const method = (readValue(), "ordinary"); unrelated[method]();',
    'let method = "__defineGetter__"; method = "ordinary"; unrelated[method]();',
  ])("does not veto unrelated computed operations: %s", (operation) => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    expect(
      lintConsumer(`import { labels } from "./provider";
        ${operation}
        labels.reduce((result, label) => [...result, label], []);`).diagnostics,
    ).toEqual([]);
  });

  it.each([
    [
      "expression count",
      Array.from({ length: FROZEN_COLLECTION_PROPERTY_KEY_MAX_EXPRESSIONS + 1 }, () => '""').join(
        "+",
      ),
    ],
    [
      "literal characters",
      JSON.stringify("x".repeat(FROZEN_COLLECTION_PROPERTY_KEY_MAX_CHARS + 1)),
    ],
  ])("refuses over-budget property keys before recursive evaluation: %s", (_label, key) => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    expect(
      lintConsumer(`import { labels } from "./provider";
        unrelated[${key}]();
        labels.reduce((result, label) => [...result, label], []);`).diagnostics,
    ).toHaveLength(1);
    expect(getFiniteStaticStringValues).not.toHaveBeenCalled();
  });

  it("bounds duplicated alias expansion before recursive evaluation", () => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    const declarations = ["const part0 = ''; "];
    for (let index = 1; index <= FROZEN_COLLECTION_PROPERTY_KEY_MAX_EXPRESSIONS; index++)
      declarations.push(`const part${index} = part${index - 1} + part${index - 1};`);
    expect(
      lintConsumer(`import { labels } from "./provider";
        ${declarations.join("\n")}
        unrelated[part${FROZEN_COLLECTION_PROPERTY_KEY_MAX_EXPRESSIONS}]();
        labels.reduce((result, label) => [...result, label], []);`).diagnostics,
    ).toHaveLength(1);
    expect(getFiniteStaticStringValues).not.toHaveBeenCalled();
  });

  it.each([
    "[arrayPrototype.reduce] = reducers;",
    "({ methods: [arrayPrototype.reduce] } = replacement);",
    "({ reduce: arrayPrototype.reduce = customReduce } = replacement);",
    "[...arrayPrototype.reduce] = reducers;",
    "({ ...arrayPrototype.reduce } = replacement);",
    "for (arrayPrototype.reduce of reducers) {}",
    "for ({ reduce: arrayPrototype.reduce } of replacements) {}",
    "for (arrayPrototype.reduce in replacements) {}",
  ])("preserves reports for nested assignment targets: %s", (assignment) => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    expect(
      lintConsumer(`import { labels } from "./provider";
        const { constructor: { prototype: arrayPrototype } } = [];
        ${assignment}
        labels.reduce((result, label) => [...result, label], []);`).diagnostics,
    ).toHaveLength(1);
  });

  it.each([
    "const { name } = record.value;",
    "const { nested: { name = record.value } } = input;",
    "({ nested: { name = record.value } } = input);",
    "({ [record.key]: name } = input);",
    "[name = record.value] = input;",
    "for ({ name = record.value } of input) {}",
    "const { constructor: { prototype: arrayPrototype } } = [];",
  ])("keeps safe destructuring reads quiet: %s", (read) => {
    writeProvider(FROZEN_ARRAY_PROVIDER);
    expect(
      lintConsumer(`import { labels } from "./provider";
        ${read}
        labels.reduce((result, label) => [...result, label], []);`).diagnostics,
    ).toEqual([]);
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
