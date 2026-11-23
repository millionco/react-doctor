import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseSourceText } from "../../utils/parse-source-file.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { readLocallyCancelledLoadingPair } from "./read-passive-loading-pair.js";

const committedPair = `
import { useCallback, useEffect, useState } from "react";
import { useRecords } from "./record-context";
export default function Panel({ visible, recordKey }) {
  const { readRecords } = useRecords();
  const [busy, setBusy] = useState(false);
  let unrelated = false;
  const clearSelection = useCallback(() => {}, []);
  useEffect(() => {
    if (!visible) { return; }
    let retired = false;
    void (async () => {
      setBusy(true);
      try {
        const records = await readRecords(recordKey);
        if (retired) return [];
        return records;
      } finally {
        if (!retired) setBusy(false);
      }
    })();
    return () => {
      retired = true;
      clearSelection();
    };
  }, [visible, recordKey, readRecords, clearSelection]);
  return <output>{String(busy)}</output>;
}
`;

const inspect = (sourceText: string) => {
  const program = parseSourceText({ filename: "Panel.tsx", sourceText });
  if (!program || !isNodeOfType(program, "Program")) throw new Error("Invalid synthetic source");
  const scopes = analyzeScopes(program);
  let owner: EsTreeNodeOfType<"FunctionDeclaration"> | undefined;
  let firstAwait: EsTreeNodeOfType<"AwaitExpression"> | undefined;
  let marker: EsTreeNodeOfType<"Identifier"> | undefined;
  walkAst(program, (node) => {
    if (isNodeOfType(node, "FunctionDeclaration") && node.id?.name === "Panel") owner = node;
    // A sibling-request test deliberately selects the last authored await.
    if (isNodeOfType(node, "AwaitExpression")) firstAwait = node;
    if (
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "Identifier") &&
      node.id.name === "retired"
    )
      marker = node.id;
  });
  const request = firstAwait && findEnclosingFunction(firstAwait);
  const cancelled = marker && scopes.symbolFor(marker);
  if (!owner || !firstAwait || !request || !cancelled)
    throw new Error("Missing synthetic selection");
  return readLocallyCancelledLoadingPair({
    owner,
    request,
    firstAwait,
    cancelled,
    context: { scopes } as RuleContext,
  });
};

const alter = (before: string, after: string) => {
  expect(committedPair).toContain(before);
  return committedPair.replace(before, after);
};

describe("private committed cancellation loading pair", () => {
  it("links the same marker, request, dependency bindings and unconditional cleanup", () => {
    expect(inspect(committedPair)).toMatchObject({
      openProperty: "visible",
      viewProperty: "recordKey",
      contextField: "readRecords",
    });
  });

  it.each([
    [
      "missing getter dependency",
      () =>
        alter(
          "[visible, recordKey, readRecords, clearSelection]",
          "[visible, recordKey, clearSelection, clearSelection]",
        ),
    ],
    [
      "conditional marker cleanup",
      () => alter("      retired = true;", "      if (visible) retired = true;"),
    ],
    [
      "different cancellation binding",
      () => alter("      retired = true;", "      unrelated = true;"),
    ],
    [
      "additional marker assignment",
      () => alter("      setBusy(true);", "      retired = false;\n      setBusy(true);"),
    ],
    [
      "unrelated sibling request",
      () =>
        alter(
          "  return <output>",
          `  useEffect(() => {
    void (async () => {
      try {
        const records = await readRecords(recordKey);
        return records;
      } finally { setBusy(false); }
    })();
  }, [visible, recordKey, readRecords, clearSelection]);
  return <output>`,
        ),
    ],
    [
      "foreign effect hook",
      () =>
        alter(
          'import { useCallback, useEffect, useState } from "react";',
          'import { useCallback, useState } from "react";\nimport { useEffect } from "preact/hooks";',
        ),
    ],
    [
      "foreign stable callback hook",
      () =>
        alter(
          'import { useCallback, useEffect, useState } from "react";',
          'import { useEffect, useState } from "react";\nimport { useCallback } from "preact/compat";',
        ),
    ],
  ])("declines %s", (_name, makeSource) => {
    expect(inspect(makeSource())).toBeNull();
  });
});
