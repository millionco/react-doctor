import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import {
  recordContentProbe,
  recordExistenceProbe,
} from "../../../utils/cross-file-probe-recorder.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStringLiteralAttributeValue } from "../../../utils/get-string-literal-attribute-value.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

// Published Framer Motion 10.16.4 under its stock exports, restricted below
// to wait mode. Both module formats put the child element through React.
const STOCK_PRESENCE_FILES = [
  ["package.json", 4770, "cd0dda6fb6fc5781c22afa0ce46d2c2db058738bdde7d61ccb88e8756f408fb9"],
  ["dist/cjs/index.js", 242202, "5328ad2e7076aec3083200c918dabd3fdb7380d0a992d87e7c16533eccda5c92"],
  ["dist/es/index.mjs", 6648, "b019c597739415ad0b9dad320baf3dfebb40b2e83b623f8d6d6ff9a9ba2a76b2"],
  [
    "dist/es/components/AnimatePresence/index.mjs",
    7605,
    "838e2748e4cd956e58eb8377130f2f4822a65619bd1d4e58647cfe906ec0ca75",
  ],
  [
    "dist/es/components/AnimatePresence/PresenceChild.mjs",
    2032,
    "c13419651c55d39c21341063f982ad2afc31606b3ecff0388220377880f536e4",
  ],
] as const;
const PACKAGE_FILE_EXTENSIONS = [".js", ".mjs", ".cjs", ".json", ".jsx", ".ts", ".tsx", ".wasm"];

const verifyStockPresencePackage = (appFilename: string, packageDirectory: string): boolean => {
  for (let current = path.dirname(appFilename); ; current = path.dirname(current)) {
    const candidate = path.join(current, "node_modules", "framer-motion");
    try {
      for (const extension of PACKAGE_FILE_EXTENSIONS) {
        const competingPath = candidate + extension;
        recordExistenceProbe(competingPath);
        if (fs.statSync(competingPath, { throwIfNoEntry: false })) return false;
      }
      recordExistenceProbe(candidate);
      const installed = fs.statSync(candidate, { throwIfNoEntry: false });
      if (installed) {
        if (!installed.isDirectory()) return false;
        return STOCK_PRESENCE_FILES.every(([relativePath, expectedSize, expectedHash]) => {
          const filename = path.join(candidate, relativePath);
          recordContentProbe(filename);
          const metadata = fs.statSync(filename, { throwIfNoEntry: false });
          return (
            metadata?.isFile() &&
            metadata.size === expectedSize &&
            createHash("sha256").update(fs.readFileSync(filename)).digest("hex") === expectedHash
          );
        });
      }
    } catch {
      return false;
    }
    if (current === packageDirectory || path.dirname(current) === current) return false;
  }
};

export const proveStockPresenceWrapper = (
  element: EsTreeNode,
  appFilename: string,
  packageDirectory: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(element, "JSXElement")) return false;
  const { name, attributes } = element.openingElement;
  if (!isNodeOfType(name, "JSXIdentifier")) return false;
  const symbol = scopes.symbolFor(name);
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    getImportedName(symbol.declarationNode) !== "AnimatePresence"
  ) {
    return false;
  }
  const declaration = symbol.declarationNode.parent;
  if (
    !isNodeOfType(declaration, "ImportDeclaration") ||
    declaration.importKind === "type" ||
    declaration.source.value !== "framer-motion"
  ) {
    return false;
  }
  if (
    attributes.some(
      (attribute) =>
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        attribute.name.name === "children",
    )
  ) {
    return false;
  }
  const mode = getAuthoritativeJsxAttribute(attributes, "mode");
  return Boolean(
    mode &&
    getStringLiteralAttributeValue(mode) === "wait" &&
    verifyStockPresencePackage(appFilename, packageDirectory),
  );
};
