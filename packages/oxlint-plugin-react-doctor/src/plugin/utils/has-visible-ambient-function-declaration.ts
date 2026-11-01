import type { ScopeDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";

const ambientDeclarationsByScope = new WeakMap<ScopeDescriptor, Map<string, boolean>>();

export const hasVisibleAmbientFunctionDeclaration = (
  initialScope: ScopeDescriptor,
  name: string,
): boolean => {
  let scope: ScopeDescriptor | null = initialScope;
  while (scope) {
    let declarations = ambientDeclarationsByScope.get(scope);
    if (!declarations) {
      declarations = new Map();
      ambientDeclarationsByScope.set(scope, declarations);
    }
    let hasDeclaration = declarations.get(name);
    if (hasDeclaration === undefined) {
      const owner = scope.node;
      let statements: ReadonlyArray<EsTreeNode> = [];
      if (
        owner.type === "Program" ||
        owner.type === "BlockStatement" ||
        owner.type === "StaticBlock"
      ) {
        statements = owner.body;
      } else if (isFunctionLike(owner) && owner.body.type === "BlockStatement") {
        statements = owner.body.body;
      } else if (owner.type === "CatchClause") {
        statements = owner.body.body;
      } else if (owner.type === "SwitchStatement") {
        statements = owner.cases.flatMap((branch) => branch.consequent);
      }
      hasDeclaration = statements.some((statement) => {
        const declaration =
          statement.type === "ExportNamedDeclaration" ||
          statement.type === "ExportDefaultDeclaration"
            ? statement.declaration
            : statement;
        return declaration?.type === "TSDeclareFunction" && declaration.id?.name === name;
      });
      declarations.set(name, hasDeclaration);
    }
    if (hasDeclaration) return true;
    scope = scope.parent;
  }
  return false;
};
