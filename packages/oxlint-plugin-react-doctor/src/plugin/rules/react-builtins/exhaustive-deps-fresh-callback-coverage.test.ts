import { describe, expect, it, vi } from "vite-plus/test";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseSourceText } from "../../utils/parse-source-file.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getFreshCallbackCoveredBindings } from "./exhaustive-deps-fresh-callback-coverage.js";

const readCoveredBindings = (
  sourceText: string,
  verifyStockCompiler: () => boolean,
): readonly string[] => {
  const program = parseSourceText({ filename: "/tmp/callback-coverage.tsx", sourceText });
  if (!program) throw new Error("Expected callback coverage fixture to parse");

  const effects: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(program, (node) => {
    if (isNodeOfType(node, "CallExpression") && getCalleeName(node) === "useEffect")
      effects.push(node);
  });
  const [effect] = effects;
  if (effects.length !== 1 || !effect) throw new Error("Expected one effect");
  return [...getFreshCallbackCoveredBindings(effect, analyzeScopes(program), verifyStockCompiler)];
};

const component = `
  import * as React from "react";
  export const Panel = ({ onCancel, shouldRun }) => {
    const cancelScheduler = React.useCallback(() => onCancel(), [onCancel]);
    const stop = React.useCallback(() => cancelScheduler(), [cancelScheduler]);
    React.useEffect(() => {
      if (shouldRun) cancelScheduler();
      else stop();
    }, [stop, shouldRun]);
    return null;
  };
`;

describe("fresh callback dependency coverage", () => {
  it("covers a capture that changes the declared callback under the verified stock compiler", () => {
    const verifyStockCompiler = vi.fn(() => true);
    expect(readCoveredBindings(component, verifyStockCompiler)).toEqual(["cancelScheduler"]);
    expect(verifyStockCompiler).toHaveBeenCalledOnce();
  });

  it("hides compiler-dependent files from the lint cache only for a matching effect shape", () => {
    const absoluteFilePath = "/tmp/callback-coverage.tsx";
    const ruleIds = ["exhaustive-deps"];
    expect(
      collectCrossFileDependencyProbes({ absoluteFilePath, sourceText: component, ruleIds }),
    ).toBeNull();
    const sourceText = component.replace(
      "[stop, shouldRun]",
      "shouldRun ? [stop] : [stop, shouldRun]",
    );
    expect(
      collectCrossFileDependencyProbes({ absoluteFilePath, sourceText, ruleIds }),
    ).not.toBeNull();
  });

  it("keeps the warning when the compiler proof fails", () => {
    const verifyStockCompiler = vi.fn(() => false);
    expect(readCoveredBindings(component, verifyStockCompiler)).toEqual([]);
    expect(verifyStockCompiler).toHaveBeenCalledOnce();
  });

  it.each([
    ["variable effect tuple", "[stop, shouldRun]", "shouldRun ? [stop] : [stop, shouldRun]"],
    ["variable carrier tuple", "[cancelScheduler]", "shouldRun ? [cancelScheduler] : []"],
    [
      "missing capture in carrier",
      "() => cancelScheduler(), [cancelScheduler]",
      "() => undefined, [cancelScheduler]",
    ],
    [
      "callback property read",
      "if (shouldRun) cancelScheduler();",
      "if (shouldRun) inspect(cancelScheduler.state);",
    ],
    ["React object escape", "return null;", "register(React); return null;"],
  ])("declines %s without probing the compiler", (_name, original, modified) => {
    expect(component).toContain(original);
    const verifyStockCompiler = vi.fn(() => true);
    expect(readCoveredBindings(component.replace(original, modified), verifyStockCompiler)).toEqual(
      [],
    );
    expect(verifyStockCompiler).not.toHaveBeenCalled();
  });
});
