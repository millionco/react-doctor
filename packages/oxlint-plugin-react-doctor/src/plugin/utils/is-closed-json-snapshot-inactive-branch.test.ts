import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "./es-tree-node.js";
import { isClosedJsonSnapshotInactiveBranch } from "./is-closed-json-snapshot-inactive-branch.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

const inspectBranch = (sourceText: string, marker = "danger"): boolean => {
  const program = parseSourceText({ filename: "branch.js", sourceText });
  expect(program).not.toBeNull();
  if (!program) throw new Error("Fixture must parse");
  let markerNode: EsTreeNode | null = null;
  walkAst(program, (node) => {
    if (isNodeOfType(node, "Identifier") && node.name === marker) markerNode = node;
  });
  if (!markerNode) throw new Error("Fixture must contain marker");
  return isClosedJsonSnapshotInactiveBranch(markerNode);
};

describe("isClosedJsonSnapshotInactiveBranch", () => {
  it.each([
    "if (module.hot) danger();",
    "if (process.env.NODE_ENV !== 'production') danger();",
    "if (process.env.NODE_ENV === 'development') danger();",
  ])("keeps unknown source environments live: %s", (source) => {
    expect(inspectBranch(source, "danger")).toBe(false);
  });

  it("folds literal false in a source projection", () => {
    expect(inspectBranch("if (false) danger();", "danger")).toBe(true);
  });

  it.each([
    `if (module.hot) { danger(); }`,
    `if (!module.hot) {} else { danger(); }`,
    `module.hot && danger();`,
    `!module.hot || danger();`,
    `module.hot ? danger() : null;`,
    `!module.hot ? null : danger();`,
    `if (process.env.NODE_ENV !== "production") danger();`,
    `if (process.env.NODE_ENV === "development") danger();`,
    `if ("production" != process.env.NODE_ENV) danger();`,
    `process.env.NODE_ENV !== "production" && danger();`,
    `process.env.NODE_ENV === "production" || danger();`,
    `if (unknown && module.hot) danger();`,
    `if (unknown || !module.hot) {} else danger();`,
    `if (module.hot) { const callback = () => danger(); }`,
  ])("keeps compiler-dependent branches live: %s", (source) => {
    expect(inspectBranch(source)).toBe(false);
  });

  it.each([
    `if (false) danger();`,
    `if (!true) danger();`,
    `if ('same' !== 'same') danger();`,
    `if (1 === 2) danger();`,
    `false && danger();`,
    `true || danger();`,
    `if (unknown && false) danger();`,
    `if (unknown || true) {} else danger();`,
  ])("proves inert literal branches: %s", (source) => {
    expect(inspectBranch(source)).toBe(true);
  });

  it.each([
    `if (!module.hot) danger();`,
    `module.hot || danger();`,
    `!module.hot && danger();`,
    `if (process.env.NODE_ENV === "production") danger();`,
    `if (module.hot !== false) danger();`,
    `if (module.hot === false) danger();`,
    `if (unknown) danger();`,
    `if (process.env.MODE === "development") danger();`,
    `function outer(module) { if (module.hot) danger(); }`,
    `function outer(process) { if (process.env.NODE_ENV !== "production") danger(); }`,
    `const module = { hot: false }; if (module.hot) danger();`,
    `const process = environment; if (process.env.NODE_ENV !== "production") danger();`,
    `const hot = module.hot; if (hot) danger();`,
    `if (module.hot()) danger();`,
    `if ((module.hot = true)) danger();`,
    `if ((process.env.NODE_ENV = "production")) danger();`,
  ])("declines an active or unknown branch: %s", (source) => {
    expect(inspectBranch(source)).toBe(false);
  });

  it("does not skip condition evaluation", () => {
    expect(inspectBranch(`if (module.hot) { noop(); }`, "module")).toBe(false);
  });

  it("declines when the enclosing branch exceeds its ancestor budget", () => {
    expect(
      inspectBranch(
        `if (module.hot) { ${"if (unknown) {".repeat(70)} danger(); ${"}".repeat(70)} }`,
      ),
    ).toBe(false);
  });
});
