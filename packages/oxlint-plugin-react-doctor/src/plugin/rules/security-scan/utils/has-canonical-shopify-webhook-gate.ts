import * as fs from "node:fs";
import * as path from "node:path";
import { CROSS_FILE_PARSE_MAX_BYTES } from "../../../constants/thresholds.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import { attachParentReferences } from "../../../utils/attach-parent-references.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import type { ScannedFile } from "../../../utils/file-scan.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { parseSourceText } from "../../../utils/parse-source-file.js";
import { getClosedShopifyValidationHandler } from "./get-closed-shopify-validation-handler.js";
import { hasClosedShopifyModule } from "./has-closed-shopify-module.js";
import { isCanonicalShopifyClient } from "./is-canonical-shopify-client.js";
import {
  SHOPIFY_FIRST_STATEMENT_INDEX,
  SHOPIFY_VALIDATION_ARGUMENT_COUNT,
} from "./shopify-webhook-constants.js";

export const hasCanonicalShopifyWebhookGate = (
  file: ScannedFile,
  readProgram: () => EsTreeNode | null,
): boolean => {
  if (
    Buffer.byteLength(file.content) > CROSS_FILE_PARSE_MAX_BYTES ||
    !path.isAbsolute(file.absolutePath) ||
    (!file.content.includes("\\u") &&
      (!file.content.includes("webhooks") || !file.content.includes("validate")))
  )
    return false;
  try {
    const program = readProgram();
    if (!program || !isNodeOfType(program, "Program")) return false;
    attachParentReferences(program);
    const scopes = analyzeScopes(program);
    if (!hasClosedShopifyModule(program, scopes)) return false;
    const handler = getClosedShopifyValidationHandler(program, scopes);
    if (!handler) return false;
    if (handler.client.kind !== "import")
      return isCanonicalShopifyClient(handler.client, scopes, handler.clientRead);
    const imported = getValueImportDeclaration(handler.client);
    if (
      !isNodeOfType(imported, "ImportDeclaration") ||
      !isNodeOfType(handler.client.declarationNode, "ImportDefaultSpecifier") ||
      !handler.client.references.every(
        (reference) => reference.flag === "read" && reference.identifier === handler.clientRead,
      ) ||
      typeof imported.source.value !== "string" ||
      !/^\.{1,2}\//.test(imported.source.value) ||
      !/\.m?js$/.test(imported.source.value)
    )
      return false;
    const providerPath = path.resolve(path.dirname(file.absolutePath), imported.source.value);
    const stat = fs.lstatSync(providerPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > CROSS_FILE_PARSE_MAX_BYTES ||
      fs.realpathSync(providerPath) !== providerPath
    )
      return false;
    const providerContent = fs.readFileSync(providerPath, "utf8");
    if (Buffer.byteLength(providerContent) > CROSS_FILE_PARSE_MAX_BYTES) return false;
    const providerProgram = parseSourceText({
      filename: providerPath,
      sourceText: providerContent,
    });
    if (!isNodeOfType(providerProgram, "Program")) return false;
    const providerScopes = analyzeScopes(providerProgram);
    if (!hasClosedShopifyModule(providerProgram, providerScopes)) return false;
    const exports = providerProgram.body.filter((statement) => statement.type.startsWith("Export"));
    const selectedExport = exports[SHOPIFY_FIRST_STATEMENT_INDEX];
    if (
      exports.length !== SHOPIFY_VALIDATION_ARGUMENT_COUNT ||
      !isNodeOfType(selectedExport, "ExportDefaultDeclaration") ||
      !isNodeOfType(selectedExport.declaration, "Identifier")
    )
      return false;
    const client = providerScopes.symbolFor(selectedExport.declaration);
    return Boolean(
      client && isCanonicalShopifyClient(client, providerScopes, selectedExport.declaration),
    );
  } catch {
    return false;
  }
};
