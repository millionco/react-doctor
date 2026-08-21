import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import { collectR3fHostRefSymbolIds } from "./collect-r3f-host-ref-symbol-ids.js";

const R3F_DATA_TEXTURE_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  "data3DTexture",
  "dataArrayTexture",
  "dataTexture",
]);

export const collectR3fDataTextureRefSymbolIds = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): ReadonlySet<number> =>
  collectR3fHostRefSymbolIds(program, scopes, (candidate) =>
    R3F_DATA_TEXTURE_ELEMENT_TYPES.has(resolveJsxElementType(candidate) ?? ""),
  );
