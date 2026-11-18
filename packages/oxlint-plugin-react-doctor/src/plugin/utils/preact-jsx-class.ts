import { collectJsxRuntimeImports } from "./collect-jsx-runtime-imports.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { hasCapability } from "./get-react-doctor-setting.js";
import { hasPreactJsxConfig } from "./preact-jsx-config.js";
import type { RuleContext } from "./rule-context.js";

const leadingCommentPattern = /^\s*(?:\/\*([\s\S]*?)\*\/|\/\/([^\r\n]*))/;
const jsxPragmaPattern = /(?:^|\s)@(jsxImportSource|jsxRuntime|jsx|jsxFrag)\b(?:[ \t]+([^\s*]+))?/g;

const readJsxPragmas = (sourceText: string): ReadonlyMap<string, string> | null => {
  const pragmas = new Map<string, string>();
  let remaining = sourceText;
  while (remaining.length > 0) {
    const match = leadingCommentPattern.exec(remaining);
    if (!match) break;
    for (const [, name, value] of (match[1] ?? match[2] ?? "").matchAll(jsxPragmaPattern)) {
      if (!name || !value || pragmas.has(name)) return null;
      pragmas.set(name, value);
    }
    remaining = remaining.slice(match[0].length);
  }
  if (/@jsx(?:ImportSource|Runtime|Frag)?\b/.test(remaining)) return null;
  return pragmas;
};

export const allowsPreactJsxClass = (
  context: RuleContext,
  program: EsTreeNodeOfType<"Program">,
): boolean => {
  const sourceText = context.getSourceText?.() ?? context.sourceCode?.getText?.();
  if (sourceText === undefined) return false;
  const pragmas = readJsxPragmas(sourceText);
  if (!pragmas || pragmas.has("jsx") || pragmas.has("jsxFrag")) return false;
  const runtime = pragmas.get("jsxRuntime");
  if (runtime !== undefined && runtime !== "automatic") return false;

  const imports = collectJsxRuntimeImports(program);
  if (imports.hasReactRuntime || imports.hasSolidRuntime) return false;
  const importSource = pragmas.get("jsxImportSource");
  if (importSource !== undefined && importSource !== "preact") return false;
  return (
    imports.hasPreactRuntime &&
    hasCapability(context.settings, "pure-preact") &&
    context.filename !== undefined &&
    hasPreactJsxConfig(context.filename)
  );
};
