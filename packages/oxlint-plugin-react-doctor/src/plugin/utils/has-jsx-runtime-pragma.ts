import { parseSync } from "oxc-parser";
import type { EsTreeNode } from "./es-tree-node.js";
import { resolveLang } from "./resolve-lang.js";

interface JsxRuntimePragmaInput {
  readonly program: EsTreeNode;
  readonly filename: string;
  readonly sourceText: string;
}

interface JsxRuntimePragmaProof {
  readonly filename: string;
  readonly sourceText: string;
  readonly hasPragma: boolean;
}

const pragmaByProgram = new WeakMap<EsTreeNode, JsxRuntimePragmaProof>();
const JSX_RUNTIME_PRAGMA_PATTERN = /@jsx(?:\s|Frag|ImportSource|Runtime)/u;

export const hasJsxRuntimePragma = ({
  program,
  filename,
  sourceText,
}: JsxRuntimePragmaInput): boolean => {
  const cached = pragmaByProgram.get(program);
  if (cached?.filename === filename && cached.sourceText === sourceText) return cached.hasPragma;
  let hasPragma = false;
  if (sourceText.includes("@jsx")) {
    try {
      const language = resolveLang(filename);
      const parsed = parseSync(filename, sourceText, {
        astType: "ts",
        lang: language === "js" ? "jsx" : language,
      });
      hasPragma =
        parsed.errors.some((error) => error.severity === "Error") ||
        parsed.comments.some((comment) => JSX_RUNTIME_PRAGMA_PATTERN.test(comment.value));
    } catch {
      hasPragma = true;
    }
  }
  pragmaByProgram.set(program, { filename, sourceText, hasPragma });
  return hasPragma;
};
