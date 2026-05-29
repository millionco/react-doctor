import { REACT_HOC_NAMES } from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { flattenCalleeName } from "./flatten-callee-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Components that are KNOWN to NOT be memoised in the current file.
// The `jsx-no-new-{function,array,object,jsx}-as-prop` rules fire on
// the premise that a downstream `React.memo`-wrapped consumer breaks
// on the new reference. For consumers we can see ARE plain
// functions in the same file (no memo/forwardRef/observer wrapper),
// that premise doesn't hold — the parent re-renders unconditionally.
export type MemoStatus = "memoised" | "not-memoised" | "unknown";

// HOC wrappers that genuinely memoize props. `forwardRef` /
// `React.forwardRef` are deliberately excluded — they forward the ref
// but don't skip re-renders when props haven't changed.
// `memo(forwardRef(fn))` is still detected because the outermost call
// is `memo`.
const HOC_NAMES_FOR_MEMOISATION: ReadonlySet<string> = new Set([
  "memo",
  "React.memo",
  "observer", // MobX
  "observable", // legend-state
  "lazy",
  "React.lazy",
  "withTracking",
]);

const isMemoisingCall = (call: EsTreeNode): boolean => {
  if (!isNodeOfType(call, "CallExpression")) return false;
  const name = flattenCalleeName(call.callee as EsTreeNode);
  return name !== null && HOC_NAMES_FOR_MEMOISATION.has(name);
};

export const buildSameFileMemoRegistry = (program: EsTreeNode): Map<string, MemoStatus> => {
  const registry = new Map<string, MemoStatus>();
  if (!isNodeOfType(program, "Program")) return registry;
  for (const statement of program.body) {
    const root = isNodeOfType(statement as { type: string } as never, "ExportNamedDeclaration")
      ? ((statement as { declaration: EsTreeNode | null }).declaration as EsTreeNode | null)
      : isNodeOfType(statement as { type: string } as never, "ExportDefaultDeclaration")
        ? ((statement as { declaration: EsTreeNode | null }).declaration as EsTreeNode | null)
        : (statement as EsTreeNode);
    if (!root) continue;
    // `const X = memo(...)` / `const X = forwardRef(...)` / plain
    // `const X = (...) => ...` / `const X = function () {}`.
    if (isNodeOfType(root, "VariableDeclaration")) {
      for (const declarator of root.declarations ?? []) {
        if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
        if (!isNodeOfType(declarator.id, "Identifier")) continue;
        if (!declarator.init) continue;
        const init = declarator.init as EsTreeNode;
        if (isMemoisingCall(init)) {
          registry.set(declarator.id.name, "memoised");
        } else if (
          isNodeOfType(init, "FunctionExpression") ||
          isNodeOfType(init, "ArrowFunctionExpression")
        ) {
          registry.set(declarator.id.name, "not-memoised");
        }
      }
      continue;
    }
    // `function X() { ... }` — plain function declaration, not memoised.
    if (isNodeOfType(root, "FunctionDeclaration") && root.id) {
      registry.set(root.id.name, "not-memoised");
      continue;
    }
  }
  return registry;
};

export const memoStatusForJsxOpeningName = (
  registry: Map<string, MemoStatus> | null,
  openingName: EsTreeNode | null | undefined,
): MemoStatus => {
  if (!registry || !openingName) return "unknown";
  if (!isNodeOfType(openingName, "JSXIdentifier")) return "unknown";
  return registry.get(openingName.name) ?? "unknown";
};
