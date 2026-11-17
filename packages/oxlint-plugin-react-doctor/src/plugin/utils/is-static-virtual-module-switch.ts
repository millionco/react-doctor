import {
  STATIC_VIRTUAL_MODULE_MAX_IDS,
  STATIC_VIRTUAL_MODULE_MAX_SOURCE_CHARS,
} from "../constants/thresholds.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { readBarePackageSpecifier } from "./read-bare-package-specifier.js";
import type { StaticAstroVirtualModuleRequirement } from "./read-static-astro-virtual-module-requirement.js";

const STATIC_VIRTUAL_MODULE_ID_PATTERN = /^[a-z0-9]+$/;

export const isStaticVirtualModuleSwitch = (
  { manifestSource, prologue, caseQuasis, epilogue }: StaticAstroVirtualModuleRequirement,
  ids: ReadonlyArray<string>,
): boolean => {
  const packageName = readBarePackageSpecifier(manifestSource)?.packageName;
  if (
    !packageName ||
    ids.length === 0 ||
    ids.length > STATIC_VIRTUAL_MODULE_MAX_IDS ||
    new Set(ids).size !== ids.length
  )
    return false;

  const [beforeCaseId, betweenIds, afterImportId] = caseQuasis;
  let sourceLength =
    prologue.length +
    epilogue.length +
    ids.length * (beforeCaseId.length + betweenIds.length + afterImportId.length);
  for (const id of ids) {
    sourceLength += id.length * 2;
    if (
      sourceLength > STATIC_VIRTUAL_MODULE_MAX_SOURCE_CHARS ||
      !STATIC_VIRTUAL_MODULE_ID_PATTERN.test(id)
    )
      return false;
  }

  const sourceText =
    prologue +
    ids.map((id) => beforeCaseId + id + betweenIds + id + afterImportId).join("") +
    epilogue;
  const program = parseSourceText({ filename: "virtual-module.mjs", sourceText });
  if (!isNodeOfType(program, "Program")) return false;
  const [exported, ...trailingStatements] = program.body;
  if (
    !isNodeOfType(exported, "ExportNamedDeclaration") ||
    exported.exportKind === "type" ||
    exported.specifiers.length !== 0 ||
    !isNodeOfType(exported.declaration, "FunctionDeclaration") ||
    exported.declaration.generator ||
    trailingStatements.some((statement) => !isNodeOfType(statement, "EmptyStatement"))
  )
    return false;

  const declaration = exported.declaration;
  const [parameter] = declaration.params;
  const [dispatch] = declaration.body.body;
  if (
    declaration.params.length !== 1 ||
    !isNodeOfType(parameter, "Identifier") ||
    declaration.body.body.length !== 1 ||
    !isNodeOfType(dispatch, "SwitchStatement") ||
    !isNodeOfType(dispatch.discriminant, "Identifier") ||
    dispatch.discriminant.name !== parameter.name ||
    dispatch.cases.length !== ids.length
  )
    return false;

  return dispatch.cases.every(({ test, consequent }, index) => {
    const id = ids[index];
    const [statement] = consequent;
    return (
      isNodeOfType(test, "Literal") &&
      test.value === id &&
      consequent.length === 1 &&
      isNodeOfType(statement, "ReturnStatement") &&
      isNodeOfType(statement.argument, "ImportExpression") &&
      !statement.argument.options &&
      isNodeOfType(statement.argument.source, "Literal") &&
      statement.argument.source.value === `${packageName}/${id}`
    );
  });
};
