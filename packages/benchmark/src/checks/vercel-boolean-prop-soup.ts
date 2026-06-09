import { BOOLEAN_PROP_SOUP_THRESHOLD } from "../constants.js";
import type { AstCheck, AstVisitorNode, ParsedSourceFile, ScanFinding } from "../types/index.js";
import { makeAstFinding } from "../utils/make-ast-finding.js";
import { walkAst } from "../utils/walk-ast.js";

interface PropertySignature {
  type?: string;
  typeAnnotation?: { typeAnnotation?: { type?: string } };
}

const countBooleanMembers = (members: unknown): number => {
  if (!Array.isArray(members)) return 0;
  let count = 0;
  for (const member of members) {
    const signature = member as PropertySignature;
    if (
      signature.type === "TSPropertySignature" &&
      signature.typeAnnotation?.typeAnnotation?.type === "TSBooleanKeyword"
    ) {
      count++;
    }
  }
  return count;
};

const endsWithProps = (name: unknown): boolean => typeof name === "string" && /Props$/.test(name);

const makeFinding = (
  file: ParsedSourceFile,
  node: AstVisitorNode,
  booleanCount: number,
): ScanFinding =>
  makeAstFinding({
    file,
    scanner: "vercel-checks",
    dimension: "composition",
    ruleId: "vercel/architecture-boolean-prop-soup",
    severity: "warning",
    offset: typeof node.start === "number" ? node.start : 0,
    message: `Props type declares ${booleanCount} boolean flags; prefer composition (variants / compound components) over boolean-prop soup.`,
  });

// Flags a props type carrying many boolean flags (Vercel
// architecture-avoid-boolean-props). Each boolean doubles the component's
// possible states; past the threshold this is the classic boolean-prop soup
// that composition (variants / compound components) should replace. Scoped to
// `*Props` declarations so unrelated config types are not penalized.
export const vercelBooleanPropSoup: AstCheck = (file): ScanFinding[] => {
  const findings: ScanFinding[] = [];
  walkAst(file.program, (node) => {
    if (node.type === "TSInterfaceDeclaration" && endsWithProps((node.id as { name?: string })?.name)) {
      const booleanCount = countBooleanMembers((node.body as { body?: unknown })?.body);
      if (booleanCount >= BOOLEAN_PROP_SOUP_THRESHOLD) findings.push(makeFinding(file, node, booleanCount));
    }
    if (
      node.type === "TSTypeAliasDeclaration" &&
      endsWithProps((node.id as { name?: string })?.name) &&
      (node.typeAnnotation as { type?: string })?.type === "TSTypeLiteral"
    ) {
      const booleanCount = countBooleanMembers((node.typeAnnotation as { members?: unknown }).members);
      if (booleanCount >= BOOLEAN_PROP_SOUP_THRESHOLD) findings.push(makeFinding(file, node, booleanCount));
    }
  });
  return findings;
};
