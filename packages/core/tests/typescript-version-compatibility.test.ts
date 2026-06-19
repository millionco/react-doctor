import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import * as ts from "typescript";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { detectPreES2023Target } from "../src/project-info/detect-pre-es2023-target.js";
import { resolveUseCallBinding } from "../src/runners/oxlint/resolve-use-call-binding.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-ts-compat-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("TypeScript version compatibility", () => {
  it("uses APIs available in TypeScript 5.0+", () => {
    expect(typeof ts.createSourceFile).toBe("function");
    expect(typeof ts.parseConfigFileTextToJson).toBe("function");
    expect(typeof ts.forEachChild).toBe("function");
    expect(typeof ts.isTypeAssertionExpression).toBe("function");
    expect(typeof ts.isSatisfiesExpression).toBe("function");
  });

  it("parses TypeScript source with createSourceFile", () => {
    const sourceText = "const x: number = 42 satisfies number;";
    const sourceFile = ts.createSourceFile(
      "test.ts",
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    expect(ts.isSourceFile(sourceFile)).toBe(true);
    expect(sourceFile.statements.length).toBeGreaterThan(0);
  });

  it("parses tsconfig with parseConfigFileTextToJson", () => {
    const tsconfigText = JSON.stringify({ compilerOptions: { target: "es2022" } });
    const parsed = ts.parseConfigFileTextToJson("tsconfig.json", tsconfigText);

    expect(parsed.error).toBeUndefined();
    expect(parsed.config).toBeDefined();
    expect(parsed.config.compilerOptions).toBeDefined();
    expect(parsed.config.compilerOptions.target).toBe("es2022");
  });

  it("detects pre-ES2023 targets via TypeScript API", () => {
    const projectDirectory = path.join(tempRoot, "ts5-compat");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "es2022" } }),
    );

    expect(detectPreES2023Target(projectDirectory)).toBe(true);
  });

  it("resolves use call bindings via TypeScript AST walking", () => {
    const sourceText = `
      import { use } from 'react';
      const data = use(promise);
    `;

    const resolution = resolveUseCallBinding(sourceText, "test.tsx", 30);
    expect(resolution).toBeDefined();
  });

  it("handles TypeScript type assertions and satisfies expressions", () => {
    const sourceText = `
      const a = <number>42;
      const b = 42 as number;
      const c = 42 satisfies number;
    `;
    const sourceFile = ts.createSourceFile(
      "test.ts",
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    let foundTypeAssertion = false;
    let foundAsExpression = false;
    let foundSatisfies = false;

    const visit = (node: ts.Node): void => {
      if (ts.isTypeAssertionExpression(node)) foundTypeAssertion = true;
      if (ts.isAsExpression(node)) foundAsExpression = true;
      if (ts.isSatisfiesExpression(node)) foundSatisfies = true;
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    expect(foundTypeAssertion).toBe(true);
    expect(foundAsExpression).toBe(true);
    expect(foundSatisfies).toBe(true);
  });
});
