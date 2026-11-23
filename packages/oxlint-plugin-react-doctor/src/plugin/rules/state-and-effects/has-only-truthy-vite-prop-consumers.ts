import * as fs from "node:fs";
import * as path from "node:path";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "../../utils/cross-file-probe-recorder.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readLiveCommonJsJestProfile } from "../../utils/read-declared-commonjs-jest-profile.js";
import { readNamedJestCaller } from "../../utils/read-named-jest-caller.js";
import { readVerifiedStockViteBrowserProject } from "../../utils/read-verified-stock-vite-browser-project.js";
import { readStockJestNamedRenderer } from "../../utils/stock-vite-providers/read-stock-jest-named-renderer.js";
import { readsVerifiedPackageLauncher } from "../../utils/stock-vite-providers/reads-verified-package-launcher.js";
import { walkAst } from "../../utils/walk-ast.js";
import { hasNoOtherMountedLoadingTests } from "./has-no-other-mounted-loading-tests.js";
import { inspectConsumer } from "./inspect-direct-jsx-prop-consumer.js";
import { readClosedJsxBrowserCaller } from "./read-closed-jsx-browser-caller.js";

interface VitePropConsumerInput {
  readonly projectRoot: string;
  readonly filename: string;
  readonly exportedName: string;
  readonly property: string;
  readonly program: EsTreeNodeOfType<"Program">;
  readonly scopes: ScopeAnalysis;
  readonly requireCompleteMountCoverage?: boolean;
}

const observeJestProfile = (kind: "exists" | "content" | "realpath", filename: string): void => {
  if (kind === "exists") recordExistenceProbe(filename);
  if (kind === "content") recordContentProbe(filename);
  if (kind === "realpath") recordRealpathProbe(filename);
};

export const hasOnlyTruthyVitePropConsumers = (input: VitePropConsumerInput): boolean => {
  try {
    const { projectRoot, filename, exportedName, property, program, scopes } = input;
    let testFile: string | undefined;
    const project = readVerifiedStockViteBrowserProject({
      projectRoot,
      filename,
      program,
      scopes,
      inspectProject: (inspection) => {
        const { index, closure, appEntry, readSource, readEmittedSource } = inspection;
        const incoming = [...(index.consumerModulesByFilePath.get(filename) ?? [])];
        const browserCallers = incoming.filter((module) => closure.reachable.has(module.filePath));
        const tests = incoming.filter((module) => !closure.reachable.has(module.filePath));
        if (browserCallers.length !== 1 || tests.length !== 1) return null;
        const caller = browserCallers[0];
        const callerSources = input.requireCompleteMountCoverage
          ? readClosedJsxBrowserCaller(caller.filePath, inspection)
          : [];
        if (!callerSources) return null;
        testFile = tests[0].filePath;
        let specifier: string | undefined;
        let opaque = false;
        walkAst(caller.programNode, (node) => {
          if (index.resolvedSourcePathByNode.get(node) !== filename) return;
          if (
            specifier !== undefined ||
            !isNodeOfType(node, "ImportExpression") ||
            !isNodeOfType(node.source, "Literal") ||
            typeof node.source.value !== "string"
          ) {
            opaque = true;
            return false;
          }
          specifier = node.source.value;
        });
        if (!specifier || opaque) return null;
        const callerText = readEmittedSource(caller.filePath) ?? readSource(caller.filePath);
        if (
          !callerText ||
          inspectConsumer(callerText, {
            route: "lazy",
            property,
            tag: "default",
            specifier,
            requireClosedDefaultFunction: input.requireCompleteMountCoverage,
          }) !== 1
        )
          return null;
        return [filename, caller.filePath, appEntry, ...callerSources];
      },
    });
    if (!project || !testFile) return false;
    const { browser } = project;
    const jestProfile = readLiveCommonJsJestProfile(projectRoot, { probe: observeJestProfile });
    if (
      !jestProfile ||
      !readNamedJestCaller({
        projectRoot,
        testFile,
        focalFile: filename,
        exportedName,
        property,
        profile: jestProfile,
      })
    )
      return false;
    const jestPath = path.join(projectRoot, "node_modules", "jest");
    recordExistenceProbe(jestPath);
    recordRealpathProbe(jestPath);
    if (
      !readsVerifiedPackageLauncher({
        projectRoot,
        projectDirectory: projectRoot,
        packageDirectory: fs.realpathSync(jestPath),
        binary: "jest",
      })
    )
      return false;
    const jest = readStockJestNamedRenderer({
      projectRoot,
      configFile: path.join(projectRoot, "jest.config.cjs"),
      tsconfigFile: path.join(projectRoot, "tsconfig.json"),
      testFile,
      reactImporterFiles: [filename, testFile],
      jsxImporterFiles: [filename, testFile],
      jsxRuntimeSpecifier: "react/jsx-runtime",
    });
    return (
      jest?.react.entry === browser.react.entry &&
      jest.client.entry === browser.renderer.entry &&
      (!input.requireCompleteMountCoverage ||
        hasNoOtherMountedLoadingTests({
          project,
          projectRoot,
          focalFile: filename,
          namedTestFile: testFile,
          jestReactEntry: jest.react.entry,
        }))
    );
  } catch {
    return false;
  }
};
