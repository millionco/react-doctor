import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { collectR3fHostRefSymbolIds } from "./collect-r3f-host-ref-symbol-ids.js";
import { isR3fPositionBufferAttribute } from "./is-r3f-position-buffer-attribute.js";

export const collectR3fPositionBufferRefSymbolIds = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): ReadonlySet<number> =>
  collectR3fHostRefSymbolIds(program, scopes, (candidate) =>
    isR3fPositionBufferAttribute(candidate, scopes),
  );
