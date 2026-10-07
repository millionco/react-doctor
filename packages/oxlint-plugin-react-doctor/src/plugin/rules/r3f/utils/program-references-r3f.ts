import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { hasImportFromModules } from "../../../utils/find-import-source-for-name.js";
import { getRequireCallSource } from "../../../utils/get-require-call-source.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { someAst } from "../../../utils/some-ast.js";
import { R3F_PUBLIC_MODULES } from "./r3f-public-modules.js";

const R3F_PUBLIC_MODULE_LIST = [...R3F_PUBLIC_MODULES];

export const programReferencesR3f = (programNode: EsTreeNodeOfType<"Program">): boolean => {
  if (hasImportFromModules(programNode, R3F_PUBLIC_MODULE_LIST)) return true;
  if (
    programNode.body.some(
      (statement) =>
        isNodeOfType(statement, "TSImportEqualsDeclaration") &&
        isNodeOfType(statement.moduleReference, "TSExternalModuleReference") &&
        isNodeOfType(statement.moduleReference.expression, "Literal") &&
        typeof statement.moduleReference.expression.value === "string" &&
        R3F_PUBLIC_MODULES.has(statement.moduleReference.expression.value),
    )
  ) {
    return true;
  }

  return someAst(programNode, (candidate) =>
    R3F_PUBLIC_MODULES.has(getRequireCallSource(candidate) ?? ""),
  );
};
