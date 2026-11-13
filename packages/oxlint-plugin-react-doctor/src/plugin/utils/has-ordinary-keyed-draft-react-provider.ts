import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import {
  getReactDoctorStringArraySetting,
  getReactDoctorStringSetting,
} from "./get-react-doctor-setting.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasUnsupportedKeyedDraftRuntime } from "./has-unsupported-keyed-draft-runtime.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";

interface KeyedDraftReactProviderProof {
  readonly sourceText: string;
  readonly ordinary: boolean;
}

const ordinaryProviderByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNodeOfType<"Program">, KeyedDraftReactProviderProof>
>();

const inspectOrdinaryReactProvider = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
  sourceText: string,
): boolean => {
  if (/@jsx(?:ImportSource|Runtime)?\s/.test(sourceText)) return false;
  if (hasUnsupportedKeyedDraftRuntime(program)) return false;
  for (const statement of program.body) {
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    if (statement.source.value.startsWith("preact")) return false;
    if (statement.source.value !== "react") continue;
    for (const specifier of statement.specifiers) {
      if (
        statement.importKind === "type" ||
        (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
      )
        continue;
      const symbol = scopes.symbolFor(specifier.local);
      if (!symbol || !hasCompleteSymbolReferences(symbol, program, scopes)) return false;
      for (const reference of symbol.references) {
        if (isKeyedDraftTypeReference(reference.identifier)) continue;
        if (reference.flag !== "read") return false;
        const callee = findTransparentExpressionRoot(reference.identifier);
        if (
          !isNodeOfType(callee.parent, "CallExpression") ||
          callee.parent.callee !== callee ||
          callee.parent.optional
        )
          return false;
      }
    }
  }
  return true;
};

export const hasOrdinaryKeyedDraftReactProvider = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
  sourceText: string,
  settings?: Readonly<Record<string, unknown>>,
): boolean => {
  if (getReactDoctorStringSetting(settings, "preactVersion")) return false;
  const capabilities = getReactDoctorStringArraySetting(settings, "capabilities");
  if (capabilities.includes("preact") && !capabilities.includes("react")) return false;
  let providerByProgram = ordinaryProviderByScopes.get(scopes);
  if (!providerByProgram) {
    providerByProgram = new WeakMap();
    ordinaryProviderByScopes.set(scopes, providerByProgram);
  }
  const cached = providerByProgram.get(program);
  if (cached?.sourceText === sourceText) return cached.ordinary;
  const ordinary = inspectOrdinaryReactProvider(program, scopes, sourceText);
  providerByProgram.set(program, { sourceText, ordinary });
  return ordinary;
};
