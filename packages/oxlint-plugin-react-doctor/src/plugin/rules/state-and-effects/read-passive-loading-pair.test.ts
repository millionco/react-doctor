import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseSourceText } from "../../utils/parse-source-file.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { readPassiveLoadingPair } from "./read-passive-loading-pair.js";

const implicitPair = `
import { useCallback, useEffect, useRef, useState } from "react";
import { useRecords } from "./local-records";
export default function Panel({ visible, recordKey }: { visible: boolean; recordKey: string }) {
  const { readRecords } = useRecords();
  const revision = useRef(0);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    if (!recordKey || !readRecords) return [];
    revision.current += 1;
    const token = revision.current;
    setLoading(true);
    try {
      const records = await readRecords(recordKey);
      return records;
    } finally {
      if (revision.current === token) setLoading(false);
    }
  }, [recordKey, readRecords]);
  const clearSelection = useCallback(() => {}, []);
  useEffect(() => {
    if (!visible) { return; }
    void refresh();
  }, [visible, refresh]);
  useEffect(() => {
    setLoading(visible);
    clearSelection();
  }, [recordKey, visible, clearSelection]);
  return <output>{String(loading)}</output>;
}
`;

const inspect = (
  sourceText: string,
  resetMode?: Parameters<typeof readPassiveLoadingPair>[0]["resetMode"],
) => {
  const program = parseSourceText({ filename: "Panel.tsx", sourceText });
  if (!program || !isNodeOfType(program, "Program")) throw new Error("Invalid authored source");
  const context = { scopes: analyzeScopes(program) } as RuleContext;
  let firstAwait: EsTreeNodeOfType<"AwaitExpression"> | undefined;
  let extraSetterIdentifier: EsTreeNode | undefined;
  walkAst(program, (node) => {
    if (isNodeOfType(node, "AwaitExpression")) firstAwait = node;
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "setLoading" &&
      !isNodeOfType(node.arguments[0], "Literal")
    ) {
      extraSetterIdentifier = node.callee;
    }
  });
  if (!firstAwait || !extraSetterIdentifier) throw new Error("Missing authored calls");
  const request = findEnclosingFunction(firstAwait);
  const owner = request && findEnclosingFunction(request);
  if (!request || !owner) throw new Error("Missing authored owner");
  return readPassiveLoadingPair({
    owner,
    request,
    extraSetterIdentifier,
    firstAwait,
    context,
    resetMode,
  });
};

describe("passive loading writer pairing", () => {
  it("selects a direct request view binding and the mounted context field", () => {
    expect(inspect(implicitPair)).toMatchObject({
      openProperty: "visible",
      viewProperty: "recordKey",
      contextField: "readRecords",
    });
  });

  it("accepts a single captured view alias initialized before the request", () => {
    const aliased = implicitPair
      .replace(
        "    revision.current += 1;",
        "    const captured = recordKey;\n    revision.current += 1;",
      )
      .replace("await readRecords(recordKey)", "await readRecords(captured)");
    expect(inspect(aliased)).toMatchObject({
      viewProperty: "recordKey",
      contextField: "readRecords",
    });
  });

  it.each([
    [
      "earlier request condition",
      "    void refresh();",
      "    if (recordKey === 'x') void refresh();",
    ],
    ["distinct opening key", "  }, [visible, refresh]);", "  }, [recordKey, refresh]);"],
    [
      "independent later dependency",
      "  const clearSelection = useCallback(() => {}, []);",
      "  const clearSelection = useCallback(() => {}, [loading]);",
    ],
    [
      "synchronous step before the await",
      "      const records = await readRecords(recordKey);",
      "      clearSelection();\n      const records = await readRecords(recordKey);",
    ],
    [
      "required request identity excluded",
      "  }, [recordKey, readRecords]);",
      "  }, [recordKey, loading]);",
    ],
    [
      "destructured assignment to the open prop",
      "  const { readRecords } = useRecords();",
      "  [visible] = [false];\n  const { readRecords } = useRecords();",
    ],
    [
      "loop assignment to the view prop",
      "  const { readRecords } = useRecords();",
      "  for ([recordKey] of [['x']]) {}\n  const { readRecords } = useRecords();",
    ],
    [
      "view alias declared after the await",
      "      const records = await readRecords(recordKey);",
      "      const records = await readRecords(captured);\n      const captured = recordKey;",
    ],
  ])("declines an unsupported %s", (_name, original, replacement) => {
    const source = implicitPair.replace(original, replacement);
    expect(source).not.toBe(implicitPair);
    expect(inspect(source)).toBeNull();
  });
});

const requestEffect = `  useEffect(() => {
    if (!visible) { return; }
    void refresh();
  }, [visible, refresh]);
`;
const resetEffect = `  useEffect(() => {
    setLoading(visible);
    clearSelection();
  }, [recordKey, visible, clearSelection]);
`;

const firstReset = implicitPair.replace(requestEffect + resetEffect, resetEffect + requestEffect);
const pairedCleanup = implicitPair
  .replace(
    "    void refresh();",
    "    void refresh();\n    return () => { revision.current += 1; };",
  )
  .replace("setLoading(visible)", "setLoading(Boolean(visible && readRecords))")
  .replace(
    "[recordKey, visible, clearSelection]",
    "[recordKey, visible, readRecords, clearSelection]",
  );

describe("passive reset ordering and request cleanup", () => {
  it("finds a reset immediately followed by a request", () => {
    expect(firstReset).not.toBe(implicitPair);
    expect(inspect(firstReset, "before-request")).toMatchObject({ openProperty: "visible" });
    expect(inspect(firstReset)).toBeNull();
  });

  it("refuses an unmodeled step between the first reset and request", () => {
    const different = firstReset.replace(resetEffect, resetEffect + "  advanceCursor();\n");
    expect(inspect(different, "before-request")).toBeNull();
  });

  it("passes the paired request cleanup to the generation check", () => {
    expect(inspect(pairedCleanup, "after-request-with-cleanup")).toMatchObject({
      contextField: "readRecords",
      requestCleanup: { type: "ExpressionStatement" },
    });
    expect(inspect(pairedCleanup)).toBeNull();
  });

  it("refuses a standalone reset dependency and a missing release", () => {
    expect(
      inspect(
        pairedCleanup.replace(
          "readRecords, clearSelection]",
          "readRecords, clearSelection, loading]",
        ),
        "after-request-with-cleanup",
      ),
    ).toBeNull();
    expect(
      inspect(
        pairedCleanup.replace("return () => { revision.current += 1; };", "return () => {};"),
        "after-request-with-cleanup",
      ),
    ).toBeNull();
  });
});
