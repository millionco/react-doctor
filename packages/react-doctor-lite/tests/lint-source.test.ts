import { describe, expect, it } from "vite-plus/test";
import { buildCapabilities } from "../src/capabilities/build-capabilities.js";
import { buildDependencyGraphFromManifest } from "../src/dependency-graph/build-dependency-graph.js";
import { loadRules } from "../src/rules/load-rules.js";
import { lintSource } from "../src/runner/lint-source.js";

const reactGraph = buildDependencyGraphFromManifest({
  dependencies: { react: "19.0.0" },
  devDependencies: { typescript: "^5.6.0" },
});

describe("in-process single-pass lint", () => {
  it("flags a known rule with line / column from oxc offsets", () => {
    const rules = loadRules({
      capabilities: buildCapabilities(reactGraph),
      selection: { only: ["no-array-index-as-key"] },
    });
    expect(rules).toHaveLength(1);

    const diagnostics = lintSource({
      filePath: "App.tsx",
      code: "const App = ({ items }) => items.map((item, index) => <li key={index}>{item}</li>);\n",
      rules,
      settings: {},
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].rule).toBe("no-array-index-as-key");
    expect(diagnostics[0].ruleKey).toBe("react-doctor/no-array-index-as-key");
    expect(diagnostics[0].line).toBe(1);
    expect(diagnostics[0].column).toBeGreaterThan(0);
  });

  it("returns nothing for clean source", () => {
    const rules = loadRules({
      capabilities: buildCapabilities(reactGraph),
      selection: { only: ["no-array-index-as-key"] },
    });
    const diagnostics = lintSource({
      filePath: "App.tsx",
      code: "const App = ({ items }) => items.map((item) => <li key={item.id}>{item.name}</li>);\n",
      rules,
      settings: {},
    });
    expect(diagnostics).toHaveLength(0);
  });

  it("runs many rules in a single tree walk", () => {
    const rules = loadRules({ capabilities: buildCapabilities(reactGraph) });
    expect(rules.length).toBeGreaterThan(50);

    const diagnostics = lintSource({
      filePath: "App.tsx",
      code: "const App = ({ items }) => items.map((item, index) => <li key={index}>{item}</li>);\n",
      rules,
      settings: {},
    });
    expect(diagnostics.some((diagnostic) => diagnostic.rule === "no-array-index-as-key")).toBe(
      true,
    );
  });
});
