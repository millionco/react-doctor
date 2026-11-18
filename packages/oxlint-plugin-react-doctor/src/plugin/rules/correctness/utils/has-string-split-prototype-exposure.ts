import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { someAst } from "../../../utils/some-ast.js";

const PROTOTYPE_EXPOSURE_GLOBALS = new Set([
  "Function",
  "Object",
  "Reflect",
  "String",
  "eval",
  "global",
  "globalThis",
  "self",
  "window",
]);
const PROTOTYPE_EXPOSURE_PROPERTIES = new Set([
  "String",
  "__proto__",
  "constructor",
  "getPrototypeOf",
  "prototype",
  "setPrototypeOf",
]);

export const hasStringSplitPrototypeExposure = (scopes: ScopeAnalysis): boolean =>
  someAst(scopes.rootScope.node, (candidate) => {
    if (isNodeOfType(candidate, "Identifier")) {
      return PROTOTYPE_EXPOSURE_GLOBALS.has(candidate.name) && scopes.isGlobalReference(candidate);
    }
    if (
      isNodeOfType(candidate, "MemberExpression") ||
      (isNodeOfType(candidate, "Property") && isNodeOfType(candidate.parent, "ObjectPattern"))
    ) {
      const propertyName = getStaticPropertyKeyName(candidate, {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      return propertyName === null || PROTOTYPE_EXPOSURE_PROPERTIES.has(propertyName);
    }
    return isNodeOfType(candidate, "WithStatement");
  });
