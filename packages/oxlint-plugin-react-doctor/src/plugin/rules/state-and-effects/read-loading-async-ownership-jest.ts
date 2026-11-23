import * as fs from "node:fs";
import * as path from "node:path";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "../../utils/cross-file-probe-recorder.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readLiveCommonJsJestProfile } from "../../utils/read-declared-commonjs-jest-profile.js";
import { readJestResolvedLoadingMock } from "../../utils/read-jest-resolved-loading-mock.js";
import { readNamedJestCaller } from "../../utils/read-named-jest-caller.js";
import { readStockJestNamedRenderer } from "../../utils/stock-vite-providers/read-stock-jest-named-renderer.js";
import { readsVerifiedPackageLauncher } from "../../utils/stock-vite-providers/reads-verified-package-launcher.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

interface LoadingJestInput {
  readonly projectRoot: string;
  readonly testFile: string;
  readonly focalFile: string;
  readonly exportedName: string;
  readonly viewProperty: string;
  readonly openProperty: string;
  readonly focalImport: string;
  readonly hookExportName: string;
  readonly contextField: string;
}

const observeProfile = (kind: "exists" | "content" | "realpath", filename: string): void => {
  if (kind === "exists") recordExistenceProbe(filename);
  if (kind === "content") recordContentProbe(filename);
  if (kind === "realpath") recordRealpathProbe(filename);
};

const literalProp = (opening: EsTreeNodeOfType<"JSXOpeningElement">, tag: string) => {
  const values = opening.attributes.filter(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") && getJsxAttributeName(attribute.name) === tag,
  );
  const [attribute] = values;
  if (values.length !== 1 || !isNodeOfType(attribute, "JSXAttribute")) return undefined;
  if (!attribute.value) return true;
  const value = isNodeOfType(attribute.value, "JSXExpressionContainer")
    ? stripParenExpression(attribute.value.expression)
    : attribute.value;
  return isNodeOfType(value, "Literal") ? value.value : undefined;
};

export const readLoadingAsyncOwnershipJest = (input: LoadingJestInput) => {
  try {
    const { projectRoot, testFile, focalFile, exportedName } = input;
    const profile = readLiveCommonJsJestProfile(projectRoot, { probe: observeProfile });
    if (!profile) return null;
    const source = readNamedJestCaller({
      projectRoot,
      testFile,
      focalFile,
      exportedName,
      profile,
      property: input.openProperty,
      checkOpening: (opening) => {
        const view = literalProp(opening, input.viewProperty);
        return (
          typeof view === "string" &&
          view.length > 0 &&
          literalProp(opening, input.openProperty) === true
        );
      },
      checkMockSetup: (scope) =>
        readJestResolvedLoadingMock(scope, {
          focalImport: input.focalImport,
          hookExportName: input.hookExportName,
          field: input.contextField,
        }),
    });
    if (!source) return null;
    const jestDirectory = path.join(projectRoot, "node_modules", "jest");
    recordExistenceProbe(jestDirectory);
    recordRealpathProbe(jestDirectory);
    if (
      !readsVerifiedPackageLauncher({
        projectRoot,
        projectDirectory: projectRoot,
        packageDirectory: fs.realpathSync(jestDirectory),
        binary: "jest",
      })
    )
      return null;
    const renderer = readStockJestNamedRenderer({
      projectRoot,
      configFile: path.join(projectRoot, "jest.config.cjs"),
      tsconfigFile: path.join(projectRoot, "tsconfig.json"),
      testFile,
      reactImporterFiles: [focalFile, testFile],
      jsxImporterFiles: [focalFile, testFile],
      jsxRuntimeSpecifier: "react/jsx-runtime",
    });
    return renderer && { source, renderer };
  } catch {
    return null;
  }
};
