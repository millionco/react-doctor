import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

interface ReducerProjectionInput {
  readonly producer?: string;
  readonly consumer?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly config?: unknown;
}

interface ReducerProjectionFixture {
  readonly directory: string;
  readonly filename: string;
  readonly source: string;
}

interface ReducerProjectionCase {
  readonly name: string;
  readonly input: ReducerProjectionInput;
  readonly missingName: string | null;
}

const producerSource = `import { useReducer } from "react";
const reducer = (state, action) => ({ ...state, visible: action.visible });
export const usePanel = ({ seed, replacements }) => {
  const [state, dispatch] = useReducer(reducer, { visible: false });
  const setVisible = (visible) => dispatch({ visible });
  const updateFromSeed = () => dispatch({ visible: seed });
  return { visible: state.visible, setVisible, updateFromSeed };
};`;

const consumerSource = `import { useEffect } from "react";
import { usePanel } from "./use-panel.js";
export const Widget = ({ seed, replacements }) => {
  const { visible, setVisible } = usePanel({ seed, replacements });
  useEffect(() => {
    setVisible(false);
  }, []);
  return <button onClick={() => setVisible(!visible)}>Toggle</button>;
};`;

const barrelConsumer = consumerSource.replace("./use-panel.js", "./index.js");
const identityConfig = { compilerOptions: { jsx: "react-jsx", paths: { "*": ["./*"] } } };
const providerMutator = `import React from "react";
React.useReducer = () => [{ visible: false }, () => {}];
export const unrelated = 1;`;
const propCapturingProducer = producerSource.replace(
  "dispatch({ visible });",
  "dispatch({ visible: seed && visible });",
);

const cases: readonly ReducerProjectionCase[] = [
  {
    name: "accepts one projected dispatch callback beside reactive fields",
    input: {},
    missingName: null,
  },
  {
    name: "accepts dispatch when the reducer changes with props",
    input: {
      producer: producerSource.replace(
        "useReducer(reducer,",
        "useReducer((previous, action) => reducer(previous, { visible: action.visible && seed }),",
      ),
    },
    missingName: null,
  },
  {
    name: "retains a callback that escapes in a later shorthand object",
    input: {
      consumer: consumerSource.replace(
        "  useEffect(() => {",
        "  publish({ setVisible });\n  useEffect(() => {",
      ),
    },
    missingName: "setVisible",
  },
  {
    name: "retains a callback assigned to another binding",
    input: {
      consumer: consumerSource.replace(
        "  useEffect(() => {",
        "  const alias = setVisible; alias(false);\n  useEffect(() => {",
      ),
    },
    missingName: "setVisible",
  },
  {
    name: "accepts a renamed own projection",
    input: {
      consumer: consumerSource
        .replace("{ visible, setVisible }", "{ visible, setVisible: close }")
        .replaceAll("setVisible(false)", "close(false)")
        .replaceAll("setVisible(!visible)", "close(!visible)"),
    },
    missingName: null,
  },
  {
    name: "accepts a unique star barrel with an unrelated export",
    input: {
      consumer: barrelConsumer,
      files: {
        "index.js": 'export * from "./unrelated.js"; export * from "./use-panel.js";',
        "unrelated.js": "export const unrelated = 1;",
      },
    },
    missingName: null,
  },
  {
    name: "accepts only the exact identity wildcard with no local React targets",
    input: { config: identityConfig },
    missingName: null,
  },
  {
    name: "retains the existing literal-zero data chain profile",
    input: {
      producer: producerSource
        .replace(
          "  const setVisible",
          '  const records = [{ entry: { label: "shown" } }]; const label = records[0].entry.label;\n  const setVisible',
        )
        .replace("return { visible:", "return { label, visible:"),
    },
    missingName: null,
  },
  {
    name: "retains a changing caller argument",
    input: { consumer: consumerSource.replace("setVisible(false)", "setVisible(seed)") },
    missingName: "seed",
  },
  {
    name: "retains the separately projected reactive sibling",
    input: {
      consumer: consumerSource
        .replace("{ visible, setVisible }", "{ visible, setVisible, updateFromSeed }")
        .replace("setVisible(false)", "updateFromSeed()"),
    },
    missingName: "updateFromSeed",
  },
  {
    name: "retains a prop-capturing selected arrow",
    input: { producer: propCapturingProducer },
    missingName: "setVisible",
  },
  {
    name: "retains a state-capturing selected arrow",
    input: {
      producer: producerSource.replace(
        "dispatch({ visible });",
        "dispatch({ visible: visible || state.visible });",
      ),
    },
    missingName: "setVisible",
  },
  {
    name: "retains a destructuring-rebound dispatch",
    input: {
      producer: producerSource
        .replace("const [state, dispatch]", "let [state, dispatch]")
        .replace("  const setVisible", "  [dispatch] = replacements;\n  const setVisible"),
    },
    missingName: "setVisible",
  },
  {
    name: "retains a mutable hook export",
    input: {
      producer:
        producerSource.replace("export const usePanel", "export let usePanel") +
        "\nexport const replacePanel = (next) => { usePanel = next; };",
    },
    missingName: "setVisible",
  },
  {
    name: "retains a mutable barrel alias",
    input: {
      consumer: barrelConsumer,
      files: {
        "index.js":
          'import { usePanel as original } from "./use-panel.js"; export let usePanel = original; export const replacePanel = (next) => { usePanel = next; };',
      },
    },
    missingName: "setVisible",
  },
  {
    name: "retains a getter in the returned literal",
    input: {
      producer: producerSource.replace(
        "setVisible, updateFromSeed };",
        "get setVisible() { return () => dispatch({ visible: seed }); }, updateFromSeed };",
      ),
    },
    missingName: "setVisible",
  },
  {
    name: "retains a mutated returned record alias",
    input: {
      producer: producerSource.replace(
        "return { visible: state.visible, setVisible, updateFromSeed };",
        "const result = { visible: state.visible, setVisible, updateFromSeed }; const alias = result; alias.setVisible = () => dispatch({ visible: seed }); return result;",
      ),
    },
    missingName: "setVisible",
  },
  {
    name: "requires every projected key to be own before reading the callback",
    input: {
      consumer: consumerSource
        .replace(
          "import { useEffect }",
          'import { installProbe } from "./install-probe.js";\nimport { useEffect }',
        )
        .replace(
          "  const { visible, setVisible }",
          "  installProbe(seed);\n  const { probe, visible, setVisible }",
        ),
      files: {
        "install-probe.js":
          'export const installProbe = (value) => { Object.defineProperty(Object.prototype, "probe", { configurable: true, get() { this.setVisible = () => save(value); return 0; } }); };',
      },
    },
    missingName: "setVisible",
  },
  {
    name: "declines nested ambiguous exports instead of treating them as absence",
    input: {
      consumer: barrelConsumer,
      files: {
        "index.js": 'export * from "./use-panel.js"; export * from "./ambiguous.js";',
        "ambiguous.js": 'export * from "./left.js"; export * from "./right.js";',
        "left.js": producerSource,
        "right.js": producerSource,
      },
    },
    missingName: "setVisible",
  },
  {
    name: "declines an unfulfilled explicit forwarding claim",
    input: {
      consumer: barrelConsumer,
      files: {
        "index.js": 'export * from "./use-panel.js"; export * from "./unfulfilled.js";',
        "unfulfilled.js": 'export { usePanel } from "./empty.js";',
        "empty.js": "export const unrelated = 1;",
      },
    },
    missingName: "setVisible",
  },
  {
    name: "declines an unvisited extra export beside a named forwarder",
    input: {
      consumer: barrelConsumer,
      files: {
        "index.js": 'export { usePanel } from "./use-panel.js"; export * from "./mutator.js";',
        "mutator.js": providerMutator,
      },
    },
    missingName: "setVisible",
  },
  {
    name: "declines an unvisited export from an absent leaf",
    input: {
      consumer: barrelConsumer,
      files: {
        "index.js": 'export * from "./use-panel.js"; export * from "./absent.js";',
        "absent.js": 'export { unrelated } from "./mutator.js";',
        "mutator.js": providerMutator,
      },
    },
    missingName: "setVisible",
  },
  {
    name: "declines an unvisited export from the definition module",
    input: {
      producer: producerSource + '\nexport { unrelated } from "./mutator.js";',
      files: { "mutator.js": providerMutator },
    },
    missingName: "setVisible",
  },
  {
    name: "refuses explicit React maps even when the target is missing",
    input: { config: { compilerOptions: { paths: { react: ["./missing.js"] } } } },
    missingName: "setVisible",
  },
  {
    name: "refuses baseUrl in the identity profile",
    input: { config: { compilerOptions: { baseUrl: ".", paths: { "*": ["./*"] } } } },
    missingName: "setVisible",
  },
  {
    name: "refuses a concrete local JSX runtime",
    input: {
      config: identityConfig,
      files: {
        "react/jsx-runtime.js":
          "export const jsx = () => null; export const jsxs = jsx; export const Fragment = null;",
      },
    },
    missingName: "setVisible",
  },
  {
    name: "fences a named caller createRequire capability",
    input: {
      consumer:
        'import { createRequire } from "node:module"; createRequire(import.meta.url)("react").useReducer = () => [{}, () => {}];\n' +
        consumerSource,
    },
    missingName: "setVisible",
  },
  {
    name: "fences a namespace caller createRequire capability",
    input: {
      consumer:
        'import * as loader from "node:module"; loader.createRequire(import.meta.url)("react").useReducer = () => [{}, () => {}];\n' +
        consumerSource,
    },
    missingName: "setVisible",
  },
  {
    name: "honors physical upstream suppression in the source profile",
    input: {
      producer: propCapturingProducer,
      consumer: consumerSource.replace(
        "  }, []);",
        "  // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);",
      ),
    },
    missingName: null,
  },
];

const withProjection = <Result>(
  input: ReducerProjectionInput,
  operation: (fixture: ReducerProjectionFixture) => Result,
): Result => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "rd-reducer-projection-")));
  const filename = path.join(directory, "widget.jsx");
  const source = input.consumer ?? consumerSource;
  try {
    const files = {
      "package.json": JSON.stringify({
        type: "module",
        main: "./widget.jsx",
        exports: { ".": "./widget.jsx" },
        dependencies: { react: "19.2.0" },
      }),
      "use-panel.js": input.producer ?? producerSource,
      "widget.jsx": source,
      ...input.files,
    };
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(directory, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    if (input.config !== undefined)
      fs.writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify(input.config));
    resetFilesystemCaches();
    return operation({ directory, filename, source });
  } finally {
    resetFilesystemCaches();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const runProjection = (fixture: ReducerProjectionFixture) =>
  runRule(exhaustiveDeps, fixture.source, { filename: fixture.filename });
const collectProjection = (fixture: ReducerProjectionFixture) =>
  collectCrossFileDependencyProbes({
    absoluteFilePath: fixture.filename,
    sourceText: fixture.source,
    ruleIds: ["exhaustive-deps"],
  });

const expectMissing = (fixture: ReducerProjectionFixture, name: string) => {
  const result = runProjection(fixture);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.message).toContain(name);
};

describe("exhaustive-deps imported reducer callback projections", () => {
  it.each(cases)("$name", ({ input, missingName }) => {
    withProjection(input, (fixture) => {
      if (missingName !== null) {
        expectMissing(fixture, missingName);
        return;
      }
      expect(runProjection(fixture)).toEqual({ diagnostics: [], parseErrors: [] });
    });
  });

  it.each([producerSource, propCapturingProducer])(
    "refuses source fingerprints independently of proof outcome",
    (producer) => {
      withProjection({ producer }, (fixture) => {
        expect(collectProjection(fixture)).toBeNull();
        runProjection(fixture);
        expect(collectProjection(fixture)).toBeNull();
      });
    },
  );

  it("records missing JSX runtime probes and observes its later appearance on relint", () => {
    withProjection({ config: identityConfig }, (fixture) => {
      const captured = captureCrossFileProbes(() => runProjection(fixture));
      expect(captured.value).toEqual({ diagnostics: [], parseErrors: [] });
      expect(captured.trace.existencePaths).toContain(
        path.join(fixture.directory, "react/jsx-runtime.js"),
      );
      expect(collectProjection(fixture)).toBeNull();
      const runtimeDirectory = path.join(fixture.directory, "react");
      fs.mkdirSync(runtimeDirectory);
      fs.writeFileSync(
        path.join(runtimeDirectory, "jsx-runtime.js"),
        "export const jsx = () => null;",
      );
      resetFilesystemCaches();
      expectMissing(fixture, "setVisible");
      expect(collectProjection(fixture)).toBeNull();
    });
  });

  it("observes an identity-to-explicit config mutation on relint", () => {
    withProjection({ config: identityConfig }, (fixture) => {
      expect(runProjection(fixture)).toEqual({ diagnostics: [], parseErrors: [] });
      fs.writeFileSync(
        path.join(fixture.directory, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { paths: { react: ["./missing.js"] } } }),
      );
      resetFilesystemCaches();
      expectMissing(fixture, "setVisible");
      expect(collectProjection(fixture)).toBeNull();
    });
  });

  it("observes an extra barrel evaluation edge on relint", () => {
    withProjection(
      {
        consumer: barrelConsumer,
        files: { "index.js": 'export { usePanel } from "./use-panel.js";' },
      },
      (fixture) => {
        expect(runProjection(fixture)).toEqual({ diagnostics: [], parseErrors: [] });
        fs.writeFileSync(
          path.join(fixture.directory, "index.js"),
          'export { usePanel } from "./use-panel.js"; export * from "./mutator.js";',
        );
        fs.writeFileSync(path.join(fixture.directory, "mutator.js"), providerMutator);
        resetFilesystemCaches();
        expectMissing(fixture, "setVisible");
        expect(collectProjection(fixture)).toBeNull();
      },
    );
  });

  it.each([producerSource, propCapturingProducer])(
    "refuses fingerprints across identical-byte symlink metadata changes",
    (producer) => {
      withProjection({ producer }, (fixture) => {
        expect(collectProjection(fixture)).toBeNull();
        const initial = runProjection(fixture);
        expect(initial.parseErrors).toEqual([]);
        expect(initial.diagnostics).toHaveLength(producer === producerSource ? 0 : 1);
        const helper = path.join(fixture.directory, "use-panel.js");
        const target = path.join(fixture.directory, "same-bytes.js");
        fs.writeFileSync(target, producer);
        fs.unlinkSync(helper);
        fs.symlinkSync(target, helper);
        resetFilesystemCaches();
        expectMissing(fixture, "setVisible");
        expect(collectProjection(fixture)).toBeNull();
        fs.unlinkSync(helper);
        fs.writeFileSync(helper, producer);
        resetFilesystemCaches();
        expect(collectProjection(fixture)).toBeNull();
        expect(runProjection(fixture).diagnostics).toHaveLength(
          producer === producerSource ? 0 : 1,
        );
      });
    },
  );
});
