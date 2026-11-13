import * as fs from "node:fs";
import * as path from "node:path";
import { CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS } from "../constants/thresholds.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPackageWithinProjectRoot } from "./is-package-within-project-root.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { isUppercaseName } from "./is-uppercase-name.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { hasUnmappedTsconfigImport } from "./resolve-tsconfig-alias.js";
import type { RuleContext } from "./rule-context.js";

const DOCUSAURUS_LINK_MODULE = "@docusaurus/Link";
const DOCUSAURUS_CONFIG_FILENAMES = ["docusaurus.config.js", "docusaurus.config.ts"];
const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
  "next.config.mts",
  "next.config.cts",
];
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const DOCUSAURUS_COMMAND_PATTERN = /^docusaurus (?:build|start|serve)$/;
const NEXT_COMMAND_TOKEN_PATTERN = /(?:^|[\s"'&;|/])next(?=$|[\s"'@&;|/])/;

const getConfigStatus = (filename: string): "file" | "missing" | "unknown" => {
  recordExistenceProbe(filename);
  try {
    const entry = fs.lstatSync(filename, { throwIfNoEntry: false });
    if (!entry) return "missing";
    return entry.isFile() ? "file" : "unknown";
  } catch {
    return "unknown";
  }
};

const hasNoNextConfig = (filename: string, packageDirectory: string): boolean => {
  let directory = path.dirname(filename);
  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level++) {
    if (
      NEXT_CONFIG_FILENAMES.some(
        (configFilename) => getConfigStatus(path.join(directory, configFilename)) !== "missing",
      )
    ) {
      return false;
    }
    if (directory === packageDirectory) return true;
    const parentDirectory = path.dirname(directory);
    if (parentDirectory === directory) return false;
    directory = parentDirectory;
  }
  return false;
};

const hasDocusaurusPackageEvidence = (context: RuleContext): boolean => {
  const filename = context.filename;
  if (!filename || !path.isAbsolute(filename) || getConfigStatus(filename) !== "file") return false;
  const packageDirectory = findNearestPackageDirectory(filename);
  const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (
    !packageDirectory ||
    !isPackageWithinProjectRoot(packageDirectory, rootDirectory, true) ||
    getConfigStatus(path.join(packageDirectory, "package.json")) !== "file"
  ) {
    return false;
  }
  const manifest = readPackageManifest(packageDirectory);
  const docusaurusVersion = manifest?.dependencies?.["@docusaurus/core"];
  if (typeof docusaurusVersion !== "string" || !EXACT_VERSION_PATTERN.test(docusaurusVersion)) {
    return false;
  }
  const scripts = manifest?.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return false;
  const scriptValues = Object.values(scripts);
  if (
    scriptValues.some(
      (script) => typeof script !== "string" || NEXT_COMMAND_TOKEN_PATTERN.test(script),
    ) ||
    !scriptValues.some(
      (script) => typeof script === "string" && DOCUSAURUS_COMMAND_PATTERN.test(script),
    )
  ) {
    return false;
  }
  const configStatuses = DOCUSAURUS_CONFIG_FILENAMES.map((configFilename) =>
    getConfigStatus(path.join(packageDirectory, configFilename)),
  );
  return (
    configStatuses.filter((status) => status === "file").length === 1 &&
    !configStatuses.includes("unknown") &&
    hasNoNextConfig(filename, packageDirectory) &&
    hasUnmappedTsconfigImport(filename, DOCUSAURUS_LINK_MODULE)
  );
};

const hasNextValueImport = (program: EsTreeNodeOfType<"Program">): boolean =>
  program.body.some((statement) => {
    if (!isNodeOfType(statement, "ImportDeclaration") || isTypeOnlyImport(statement)) return false;
    const source = statement.source.value;
    return typeof source === "string" && (source === "next" || source.startsWith("next/"));
  });

export const createDocusaurusLinkImageCheck = (context: RuleContext) => {
  let isDocusaurusContext: boolean | undefined;
  return (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
    if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "img") return false;
    const imageElement = node.parent;
    if (!isNodeOfType(imageElement, "JSXElement")) return false;
    let owner = imageElement.parent;
    if (!isNodeOfType(owner, "JSXElement")) return false;
    const wrapperName = owner.openingElement.name;
    if (isNodeOfType(wrapperName, "JSXIdentifier") && wrapperName.name === "div") {
      owner = owner.parent;
    }
    if (!isNodeOfType(owner, "JSXElement")) return false;
    const ownerName = owner.openingElement.name;
    if (!isNodeOfType(ownerName, "JSXIdentifier") || !isUppercaseName(ownerName.name)) return false;
    const ownerSymbol = context.scopes.symbolFor(ownerName);
    if (
      !ownerSymbol ||
      !isNodeOfType(ownerSymbol.declarationNode, "ImportDefaultSpecifier") ||
      getValueImportSource(ownerSymbol) !== DOCUSAURUS_LINK_MODULE ||
      ownerSymbol.references.some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
    if (isDocusaurusContext === undefined) {
      const program = findProgramRoot(node);
      isDocusaurusContext = Boolean(
        program && !hasNextValueImport(program) && hasDocusaurusPackageEvidence(context),
      );
    }
    return isDocusaurusContext;
  };
};
