import type { AstCheck, ScanFinding } from "../types/index.js";
import { makeAstFinding } from "../utils/make-ast-finding.js";
import { walkAst } from "../utils/walk-ast.js";

const RENDER_PROP_NAME_PATTERN = /^render([A-Z].*)?$/;

const keyName = (key: unknown): string | undefined => {
  const identifier = key as { type?: string; name?: string; value?: string };
  if (identifier?.type === "Identifier") return identifier.name;
  if (identifier?.type === "Literal") return identifier.value;
  return undefined;
};

// Flags function-valued `render` / `renderX` props (Vercel
// patterns-children-over-render-props). A render prop threads JSX through a
// callback where `children` (or a compound component) would compose more
// cleanly and stay readable as the component grows.
export const vercelRenderProp: AstCheck = (file): ScanFinding[] => {
  const findings: ScanFinding[] = [];
  walkAst(file.program, (node) => {
    if (node.type !== "TSPropertySignature") return;
    const name = keyName(node.key);
    if (!name || !RENDER_PROP_NAME_PATTERN.test(name)) return;
    const annotationType = (node.typeAnnotation as { typeAnnotation?: { type?: string } })
      ?.typeAnnotation?.type;
    if (annotationType !== "TSFunctionType") return;
    findings.push(
      makeAstFinding({
        file,
        scanner: "vercel-checks",
        dimension: "composition",
        ruleId: "vercel/patterns-render-prop",
        severity: "warning",
        offset: typeof node.start === "number" ? node.start : 0,
        message: `Render prop \`${name}\` passes JSX through a callback; prefer \`children\` / compound components for composition.`,
      }),
    );
  });
  return findings;
};
