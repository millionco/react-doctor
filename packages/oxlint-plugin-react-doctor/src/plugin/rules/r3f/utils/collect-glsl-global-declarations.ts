import type {
  ArraySpecifierNode,
  AstNode,
  DeclarationNode,
  Program,
} from "@shaderfrog/glsl-parser/ast/ast-types.js";
import { getGlslNumericConstant } from "./get-glsl-numeric-constant.js";
import { getGlslTypeSpecifierName } from "./get-glsl-type-specifier-name.js";

export interface GlslGlobalDeclaration {
  readonly arraySize: number | null | undefined;
  readonly hasLayoutQualifier: boolean;
  readonly interpolation: string;
  readonly isStaticallyUsed: boolean;
  readonly name: string;
  readonly node: DeclarationNode;
  readonly qualifiers: ReadonlySet<string>;
  readonly typeName: string;
}

const GLSL_INTERPOLATION_QUALIFIER_NAMES = new Set([
  "centroid",
  "flat",
  "noperspective",
  "sample",
  "smooth",
]);
const GLSL_PRIMARY_INTERPOLATION_QUALIFIER_NAMES = new Set(["flat", "noperspective", "smooth"]);

const getArraySize = (
  declaration: DeclarationNode,
  typeQuantifiers: ReadonlyArray<ArraySpecifierNode> | null,
): number | null | undefined => {
  const quantifiers = [
    ...(Array.isArray(typeQuantifiers) ? typeQuantifiers : []),
    ...(Array.isArray(declaration.quantifier) ? declaration.quantifier : []),
  ];
  if (quantifiers.length === 0) return null;
  if (quantifiers.length !== 1) return undefined;
  return getGlslNumericConstant(quantifiers[0].expression) ?? undefined;
};

const getQualifierName = (qualifier: AstNode): string | null =>
  qualifier.type === "keyword" ? qualifier.token : null;

const getInterpolation = (qualifiers: ReadonlySet<string>): string => {
  const interpolationQualifiers = [...qualifiers].filter((qualifier) =>
    GLSL_INTERPOLATION_QUALIFIER_NAMES.has(qualifier),
  );
  if (
    !interpolationQualifiers.some((qualifier) =>
      GLSL_PRIMARY_INTERPOLATION_QUALIFIER_NAMES.has(qualifier),
    )
  ) {
    interpolationQualifiers.push("smooth");
  }
  return interpolationQualifiers.sort().join(" ");
};

export const collectGlslGlobalDeclarations = (program: Program): GlslGlobalDeclaration[] => {
  const declarations: GlslGlobalDeclaration[] = [];
  const globalBindings = program.scopes[0]?.bindings;
  for (const statement of program.program) {
    if (
      statement.type !== "declaration_statement" ||
      statement.declaration.type !== "declarator_list"
    ) {
      continue;
    }
    const declaratorList = statement.declaration;
    const typeName = getGlslTypeSpecifierName(declaratorList.specified_type.specifier);
    if (!typeName) continue;
    const qualifierNodes = declaratorList.specified_type.qualifiers ?? [];
    const qualifiers = new Set<string>();
    let hasLayoutQualifier = false;
    for (const qualifier of qualifierNodes) {
      if (qualifier.type === "layout_qualifier") {
        hasLayoutQualifier = true;
        continue;
      }
      const qualifierName = getQualifierName(qualifier);
      if (qualifierName) qualifiers.add(qualifierName);
    }
    for (const declaration of declaratorList.declarations) {
      const name = declaration.identifier.identifier;
      const binding = globalBindings?.[name];
      declarations.push({
        arraySize: getArraySize(declaration, declaratorList.specified_type.specifier.quantifier),
        hasLayoutQualifier,
        interpolation: getInterpolation(qualifiers),
        isStaticallyUsed: Boolean(
          binding?.references.some((reference) => reference !== binding.declaration),
        ),
        name,
        node: declaration,
        qualifiers,
        typeName,
      });
    }
  }
  return declarations;
};
