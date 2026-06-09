import type { AstCheck } from "../types/index.js";
import { deslopNestedTernary } from "./deslop-nested-ternary.js";
import { tsBanTsComment } from "./ts-ban-ts-comment.js";
import { tsNoExplicitAny } from "./ts-no-explicit-any.js";
import { tsNoNonNullAssertion } from "./ts-no-non-null-assertion.js";
import { tsNoTypeAssertion } from "./ts-no-type-assertion.js";
import { vercelBooleanPropSoup } from "./vercel-boolean-prop-soup.js";
import { vercelRenderProp } from "./vercel-render-prop.js";

// Every AST check, run once per parsed source file. These cover the slop React
// Doctor does not: TypeScript strictness, Vercel composition patterns, and the
// deslop nested-ternary heuristic. See `rule-overlap.md` for ownership.
export const AST_CHECKS: readonly AstCheck[] = [
  tsNoExplicitAny,
  tsNoNonNullAssertion,
  tsNoTypeAssertion,
  tsBanTsComment,
  vercelBooleanPropSoup,
  vercelRenderProp,
  deslopNestedTernary,
];
