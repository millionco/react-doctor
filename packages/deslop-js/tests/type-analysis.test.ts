import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { analyze, defineConfig } from "../src/index.js";
import { FIXTURES_DIR } from "./helpers/fixtures-dir.js";

interface DifferentialOutcome {
  deslopFlags: Set<string>;
  tsExpectedUnused: Set<string>;
  declaredTypeNames: Set<string>;
}

const collectDeclaredExportedTypeNames = (
  program: ts.Program,
  checker: ts.TypeChecker,
): Set<string> => {
  const declaredNames = new Set<string>();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
      const resolvedSymbol =
        exportSymbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exportSymbol)
          : exportSymbol;
      const isPureType =
        Boolean(
          resolvedSymbol.flags &
          (ts.SymbolFlags.Interface |
            ts.SymbolFlags.TypeAlias |
            ts.SymbolFlags.Enum |
            ts.SymbolFlags.RegularEnum |
            ts.SymbolFlags.ConstEnum),
        ) &&
        !(
          resolvedSymbol.flags &
          (ts.SymbolFlags.Variable |
            ts.SymbolFlags.Function |
            ts.SymbolFlags.Class |
            ts.SymbolFlags.BlockScopedVariable |
            ts.SymbolFlags.FunctionScopedVariable)
        );
      if (isPureType) {
        declaredNames.add(exportSymbol.name);
      }
    }
  }
  return declaredNames;
};

const countNonDeclarationReferences = (
  program: ts.Program,
  checker: ts.TypeChecker,
  targetSymbol: ts.Symbol,
): number => {
  let referenceCount = 0;

  const visitForReferences = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const resolvedSymbol =
        symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      if (resolvedSymbol === targetSymbol) {
        const parent = node.parent;
        const isDeclarationName =
          parent &&
          (ts.isInterfaceDeclaration(parent) ||
            ts.isTypeAliasDeclaration(parent) ||
            ts.isEnumDeclaration(parent) ||
            ts.isClassDeclaration(parent) ||
            ts.isFunctionDeclaration(parent) ||
            ts.isVariableDeclaration(parent)) &&
          parent.name === node;
        const isExportSpecifier = parent && ts.isExportSpecifier(parent);
        if (!isDeclarationName && !isExportSpecifier) {
          referenceCount++;
        }
      }
    }
    ts.forEachChild(node, visitForReferences);
    const jsDocContainer = node as ts.Node & { jsDoc?: ts.JSDoc[] };
    if (jsDocContainer.jsDoc) {
      for (const jsDocNode of jsDocContainer.jsDoc) {
        visitForReferences(jsDocNode);
      }
    }
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    visitForReferences(sourceFile);
  }

  return referenceCount;
};

const runDifferential = async (fixtureName: string): Promise<DifferentialOutcome> => {
  const fixtureDir = resolve(FIXTURES_DIR, fixtureName);
  const result = await analyze(
    defineConfig({
      rootDir: fixtureDir,
      semantic: { enabled: true },
    }),
  );

  const tsconfigPath = resolve(fixtureDir, "tsconfig.json");
  const configContents = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    configContents.config,
    ts.sys,
    dirname(tsconfigPath),
    { noEmit: true, skipLibCheck: true },
    tsconfigPath,
  );
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
  const checker = program.getTypeChecker();

  const declaredTypeNames = collectDeclaredExportedTypeNames(program, checker);
  const tsExpectedUnused = new Set<string>();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
      if (!declaredTypeNames.has(exportSymbol.name)) continue;
      const resolvedSymbol =
        exportSymbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exportSymbol)
          : exportSymbol;
      const referenceCount = countNonDeclarationReferences(program, checker, resolvedSymbol);
      if (referenceCount === 0) {
        tsExpectedUnused.add(exportSymbol.name);
      }
    }
  }

  return {
    deslopFlags: new Set(result.unusedTypes.map((unusedType) => unusedType.name)),
    tsExpectedUnused,
    declaredTypeNames,
  };
};

const assertDeslopSubsetOfTsExpected = (
  outcome: DifferentialOutcome,
  fixtureName: string,
): void => {
  for (const deslopName of outcome.deslopFlags) {
    assert.ok(
      outcome.tsExpectedUnused.has(deslopName),
      `[${fixtureName}] deslop flagged "${deslopName}" but the differential checker did not. ` +
        `Either the rule is a false positive, or document the divergence in this test name. ` +
        `ts-expected: ${[...outcome.tsExpectedUnused]} | deslop: ${[...outcome.deslopFlags]}`,
    );
  }
};

describe("type-analysis differential (Tier 2)", () => {
  for (const fixtureName of [
    "unused-types-basic",
    "unused-types-nested",
    "unused-types-extends",
    "unused-types-decl-merge",
    "unused-types-generics",
    "unused-types-import-type",
    "unused-types-jsdoc",
  ]) {
    it(`${fixtureName}: deslop.unusedTypes is a subset of TS-known-unused`, async () => {
      const outcome = await runDifferential(fixtureName);
      assertDeslopSubsetOfTsExpected(outcome, fixtureName);
    });
  }

  it("unused-types-reexport-chain: deslop's medium-confidence covers re-export ghosts (divergence documented)", async () => {
    const outcome = await runDifferential("unused-types-reexport-chain");
    for (const deslopName of outcome.deslopFlags) {
      if (outcome.tsExpectedUnused.has(deslopName)) continue;
      assert.ok(
        outcome.declaredTypeNames.has(deslopName),
        `${deslopName} must be a declared type even when re-exported`,
      );
    }
  });
});
