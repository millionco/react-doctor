import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getProgramAnalysis } from "./effect/get-program-analysis.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { isImportedRecordMemberAlias } from "./is-imported-record-member-alias.js";

interface InventoryVisits {
  callbackReferences: number;
  recordReferences: number;
  recordProperties: number;
  importedReferences: number;
}

interface AliasInventoryOptions {
  size: number;
  mode: "same-alias" | "many-aliases" | "wide-record";
  doesEscape?: boolean;
  isImported?: boolean;
}

interface AliasInventory {
  analysis: ProgramAnalysis;
  scopes: ScopeAnalysis;
  callees: EsTreeNode[];
  visits: InventoryVisits;
}

const INVENTORY_SIZES = [16, 32, 64, 128];

const countArrayVisits = <Item>(items: Item[], visit: () => void): Item[] =>
  new Proxy(items, {
    get: (target, property, receiver) => {
      if (typeof property === "string" && /^(0|[1-9][0-9]*)$/.test(property)) visit();
      return Reflect.get(target, property, receiver);
    },
  });

const createAliasInventory = ({
  size,
  mode,
  doesEscape = false,
  isImported = true,
}: AliasInventoryOptions): AliasInventory => {
  const propertyValue = isImported ? "importedCallback" : "parentProp";
  const properties =
    mode === "wide-record"
      ? Array.from({ length: size }, (_, index) => `dispatch${index}: ${propertyValue}`).join(",")
      : `dispatch: ${propertyValue}`;
  const aliases = Array.from(
    { length: mode === "same-alias" ? 1 : size },
    (_, index) =>
      `const chosen${index} = handlers.${mode === "wide-record" ? `dispatch${index}` : "dispatch"};`,
  ).join("\n");
  const calls = Array.from(
    { length: size },
    (_, index) => `chosen${mode === "same-alias" ? 0 : index}(1);`,
  ).join("\n");
  const parsed = parseFixture(`import { importedCallback } from "./external-callback";
const Child = ({ parentProp }) => {
  const handlers = { notify: parentProp, ${properties} };
  ${doesEscape ? "opaque(handlers);" : ""}
  ${aliases}
  ${calls}
  return null;
};`);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const analysis = getProgramAnalysis(parsed.program);
  if (!analysis) throw new Error("Expected program analysis");
  const scopes = analyzeScopes(parsed.program);
  const callees: EsTreeNode[] = [];
  walkAst(parsed.program, (node) => {
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name.startsWith("chosen")
    ) {
      callees.push(node.callee);
    }
  });
  const visits: InventoryVisits = {
    callbackReferences: 0,
    recordReferences: 0,
    recordProperties: 0,
    importedReferences: 0,
  };
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const currentScope = pendingScopes.pop();
    if (!currentScope) continue;
    pendingScopes.push(...currentScope.children);
    for (const symbol of currentScope.symbols) {
      if (symbol.name.startsWith("chosen")) {
        Object.defineProperty(symbol, "references", {
          value: countArrayVisits(symbol.references, () => visits.callbackReferences++),
        });
      }
      if (symbol.name !== "handlers") continue;
      Object.defineProperty(symbol, "references", {
        value: countArrayVisits(symbol.references, () => visits.recordReferences++),
      });
      if (!isNodeOfType(symbol.initializer, "ObjectExpression")) {
        throw new Error("Expected local record");
      }
      Object.defineProperty(symbol.initializer, "properties", {
        value: countArrayVisits(symbol.initializer.properties, () => visits.recordProperties++),
      });
    }
  }
  for (const scope of analysis.scopeManager.scopes) {
    for (const variable of scope.variables) {
      if (variable.name !== "importedCallback") continue;
      Object.defineProperty(variable, "references", {
        value: countArrayVisits(variable.references, () => visits.importedReferences++),
      });
    }
  }
  return { analysis, scopes, callees, visits };
};

const checkAliases = (
  inventory: AliasInventory,
  scopes = inventory.scopes,
  analysis = inventory.analysis,
): boolean[] =>
  inventory.callees.map((expression) =>
    isImportedRecordMemberAlias({ analysis, expression, scopes }),
  );

describe("imported record member alias static inventory work", () => {
  it.each(INVENTORY_SIZES)("checks repeated callback references once at %i calls", (size) => {
    const inventory = createAliasInventory({ size, mode: "same-alias" });
    expect(checkAliases(inventory)).toEqual(Array(size).fill(true));
    expect(inventory.visits).toEqual({
      callbackReferences: size,
      recordReferences: 1,
      recordProperties: 2,
      importedReferences: 1,
    });
  });

  it.each(INVENTORY_SIZES)("checks a shared record once at %i aliases", (size) => {
    const inventory = createAliasInventory({ size, mode: "many-aliases" });
    expect(checkAliases(inventory)).toEqual(Array(size).fill(true));
    expect(inventory.visits).toEqual({
      callbackReferences: size,
      recordReferences: size,
      recordProperties: 2,
      importedReferences: 1,
    });
  });

  it.each(INVENTORY_SIZES)("checks a shared import once at %i record fields", (size) => {
    const inventory = createAliasInventory({ size, mode: "wide-record" });
    expect(checkAliases(inventory)).toEqual(Array(size).fill(true));
    expect(inventory.visits).toEqual({
      callbackReferences: size,
      recordReferences: size,
      recordProperties: size + 1,
      importedReferences: size,
    });
  });

  it.each(INVENTORY_SIZES)("caches an escaped record rejection at %i calls", (size) => {
    const inventory = createAliasInventory({ size, mode: "same-alias", doesEscape: true });
    expect(checkAliases(inventory)).toEqual(Array(size).fill(false));
    expect(inventory.visits.callbackReferences).toBe(size);
    expect(inventory.visits.recordReferences).toBe(1);
    expect(inventory.visits.recordProperties).toBe(0);
    expect(inventory.visits.importedReferences).toBe(0);
  });

  it.each(INVENTORY_SIZES)("caches a parent origin rejection at %i aliases", (size) => {
    const inventory = createAliasInventory({ size, mode: "many-aliases", isImported: false });
    expect(checkAliases(inventory)).toEqual(Array(size).fill(false));
    expect(inventory.visits.recordReferences).toBe(size);
    expect(inventory.visits.recordProperties).toBe(2);
    expect(inventory.visits.importedReferences).toBe(0);
  });

  it("isolates scope and program analysis identities and retains negative results", () => {
    const inventory = createAliasInventory({ size: 16, mode: "wide-record" });
    expect(checkAliases(inventory)).toEqual(Array(16).fill(true));
    const initialVisits = { ...inventory.visits };
    expect(checkAliases(inventory)).toEqual(Array(16).fill(true));
    expect(inventory.visits).toEqual(initialVisits);
    expect(checkAliases(inventory, { ...inventory.scopes })).toEqual(Array(16).fill(true));
    expect(inventory.visits.recordReferences).toBe(initialVisits.recordReferences * 2);
    expect(checkAliases(inventory, inventory.scopes, { ...inventory.analysis })).toEqual(
      Array(16).fill(true),
    );
    expect(inventory.visits.recordReferences).toBe(initialVisits.recordReferences * 3);
    const escapedInventory = createAliasInventory({
      size: 16,
      mode: "wide-record",
      doesEscape: true,
    });
    expect(checkAliases(escapedInventory)).toEqual(Array(16).fill(false));
    const rejectedVisits = { ...escapedInventory.visits };
    expect(checkAliases(escapedInventory)).toEqual(Array(16).fill(false));
    expect(escapedInventory.visits).toEqual(rejectedVisits);
    expect(checkAliases(inventory)).toEqual(Array(16).fill(true));
    expect(inventory.visits.recordReferences).toBe(initialVisits.recordReferences * 3);
  });
});
