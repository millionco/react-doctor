import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "./scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "../utils/es-tree-node.js";

const analyze = (code: string) => {
  const parsed = parseFixture(code);
  attachParentReferences(parsed.program);
  return { ...analyzeScopes(parsed.program), program: parsed.program };
};

const findFirstNamedNode = (root: EsTreeNode, type: string, name?: string): EsTreeNode | null => {
  let result: EsTreeNode | null = null;
  const visit = (node: EsTreeNode): void => {
    if (result) return;
    if (node.type === type) {
      if (name === undefined || (node as { name?: string }).name === name) {
        result = node;
        return;
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) {
            visit(item as EsTreeNode);
            if (result) return;
          }
        }
      } else if (child && typeof child === "object" && "type" in (child as object)) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(root);
  return result;
};

const findAllNamedNodes = (root: EsTreeNode, type: string, name?: string): EsTreeNode[] => {
  const out: EsTreeNode[] = [];
  const visit = (node: EsTreeNode): void => {
    if (node.type === type) {
      if (name === undefined || (node as { name?: string }).name === name) {
        out.push(node);
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) {
            visit(item as EsTreeNode);
          }
        }
      } else if (child && typeof child === "object" && "type" in (child as object)) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(root);
  return out;
};

describe("scope-analysis", () => {
  describe("module scope bindings", () => {
    it("binds top-level const", () => {
      const { rootScope } = analyze(`const foo = 1;`);
      expect(rootScope.symbolsByName.get("foo")).toBeDefined();
      expect(rootScope.symbolsByName.get("foo")!.kind).toBe("const");
    });

    it("binds top-level let / var / function / class", () => {
      const { rootScope } = analyze(`
        let a = 1;
        var b = 2;
        function c() {}
        class D {}
      `);
      expect(rootScope.symbolsByName.get("a")?.kind).toBe("let");
      expect(rootScope.symbolsByName.get("b")?.kind).toBe("var");
      expect(rootScope.symbolsByName.get("c")?.kind).toBe("function");
      expect(rootScope.symbolsByName.get("D")?.kind).toBe("class");
    });

    it("binds destructuring patterns", () => {
      const { rootScope } = analyze(`
        const { a, b: { c } } = obj;
        const [x, y, ...z] = arr;
      `);
      for (const name of ["a", "c", "x", "y", "z"]) {
        expect(rootScope.symbolsByName.get(name), `binding ${name}`).toBeDefined();
      }
    });

    it("binds import specifiers", () => {
      const { rootScope } = analyze(`
        import Default, { foo, bar as baz } from "x";
        import * as ns from "y";
      `);
      expect(rootScope.symbolsByName.get("Default")?.kind).toBe("import");
      expect(rootScope.symbolsByName.get("foo")?.kind).toBe("import");
      expect(rootScope.symbolsByName.get("baz")?.kind).toBe("import");
      expect(rootScope.symbolsByName.get("ns")?.kind).toBe("import");
    });
  });

  describe("hoisting", () => {
    it("hoists var inside a function to the function scope", () => {
      const analysis = analyze(`
        function outer() {
          if (cond) {
            var hoisted = 1;
          }
        }
      `);
      const fn = findFirstNamedNode(analysis.program, "FunctionDeclaration")!;
      const fnScope = analysis.scopeFor(fn);
      // Walk into the function scope: it's a child of root.
      const childScope = fnScope.children[0]!;
      expect(childScope.kind).toBe("function");
      expect(childScope.symbolsByName.get("hoisted")?.kind).toBe("var");
    });

    it("does not hoist let across blocks", () => {
      const analysis = analyze(`
        function outer() {
          {
            let scoped = 1;
          }
        }
      `);
      const fn = findFirstNamedNode(analysis.program, "FunctionDeclaration")!;
      const fnScope = analysis.scopeFor(fn).children[0]!;
      expect(fnScope.symbolsByName.get("scoped")).toBeUndefined();
      // Should be inside the inner block scope.
      const blockScope = fnScope.children[0]!;
      expect(blockScope.kind).toBe("block");
      expect(blockScope.symbolsByName.get("scoped")?.kind).toBe("let");
    });

    it("hoists function declarations", () => {
      const { rootScope } = analyze(`
        if (true) {
          function inner() {}
        }
      `);
      // ES2015+ block-scopes function declarations, but our model
      // hoists to the nearest function/program scope (matching
      // sloppy-mode + most real codebases). Ensure `inner` is in the
      // module scope.
      expect(rootScope.symbolsByName.get("inner")?.kind).toBe("function");
    });
  });

  describe("function expression / class expression name visibility", () => {
    it("function expression name only visible inside body", () => {
      const analysis = analyze(`
        const foo = function bar() { bar(); };
        bar;
      `);
      // The reference inside the FE body resolves to the FE's name.
      const refs = findAllNamedNodes(analysis.program, "Identifier", "bar");
      const innerBarRef = refs.find((node) => node.parent?.type === "CallExpression");
      expect(innerBarRef).toBeDefined();
      expect(analysis.symbolFor(innerBarRef!)?.kind).toBe("function");
      // Outer reference 'bar;' should be unresolved (global).
      const outerBarRef = refs.find((node) => node.parent?.type === "ExpressionStatement");
      expect(outerBarRef).toBeDefined();
      expect(analysis.symbolFor(outerBarRef!)).toBeNull();
    });

    it("class expression name only visible inside class body", () => {
      const analysis = analyze(`
        const X = class Y { foo() { return Y; } };
        // outer reference to Y is unresolved
        function check() { return Y; }
      `);
      const refs = findAllNamedNodes(analysis.program, "Identifier", "Y");
      const innerY = refs.find((node) => {
        let parent: EsTreeNode | null | undefined = node.parent;
        while (parent) {
          if (parent.type === "ClassExpression") return true;
          parent = parent.parent ?? null;
        }
        return false;
      });
      expect(innerY).toBeDefined();
      expect(analysis.symbolFor(innerY!)?.kind).toBe("class");
      // Outer reference is unresolved.
      const outerY = refs.find((node) => {
        let parent: EsTreeNode | null | undefined = node.parent;
        while (parent) {
          if (parent.type === "ClassExpression") return false;
          if (parent.type === "FunctionDeclaration") return true;
          parent = parent.parent ?? null;
        }
        return false;
      });
      expect(outerY).toBeDefined();
      expect(analysis.symbolFor(outerY!)).toBeNull();
    });
  });

  describe("for / catch scopes", () => {
    it("for(let i …) puts i in for scope, not body", () => {
      const analysis = analyze(`
        for (let i = 0; i < 10; i++) { console.log(i); }
      `);
      const forStmt = findFirstNamedNode(analysis.program, "ForStatement")!;
      const forScope = analysis.scopeFor(forStmt);
      expect(forScope.symbolsByName.get("i")?.kind).toBe("let");
    });

    it("catch parameter is in a separate scope", () => {
      const analysis = analyze(`
        try { } catch (err) { console.log(err); }
      `);
      const catchClause = findFirstNamedNode(analysis.program, "CatchClause")!;
      const catchScope = analysis.scopeFor(catchClause);
      expect(catchScope.kind).toBe("catch");
      expect(catchScope.symbolsByName.get("err")?.kind).toBe("catch-clause-parameter");
    });
  });

  describe("reference resolution", () => {
    it("resolves identifier reference to its declaring symbol", () => {
      const analysis = analyze(`
        const x = 1;
        x;
      `);
      const exprStatement = findAllNamedNodes(analysis.program, "Identifier", "x").find(
        (node) => node.parent?.type === "ExpressionStatement",
      );
      expect(exprStatement).toBeDefined();
      const resolved = analysis.symbolFor(exprStatement!);
      expect(resolved?.kind).toBe("const");
    });

    it("returns null for a global / unresolved reference", () => {
      const analysis = analyze(`window;`);
      const ref = findAllNamedNodes(analysis.program, "Identifier", "window")[0]!;
      expect(analysis.symbolFor(ref)).toBeNull();
      expect(analysis.isGlobalReference(ref)).toBe(true);
    });

    it("resolves through nested scopes (inner function captures outer var)", () => {
      const analysis = analyze(`
        const captured = 1;
        function inner() { return captured; }
      `);
      const refs = findAllNamedNodes(analysis.program, "Identifier", "captured");
      const insideFn = refs.find((node) => node.parent?.type === "ReturnStatement")!;
      const symbol = analysis.symbolFor(insideFn);
      expect(symbol?.kind).toBe("const");
      expect(symbol?.scope.kind).toBe("module");
    });

    it("inner block-scoped binding is NOT visible outside", () => {
      const analysis = analyze(`
        { const blocked = 1; }
        blocked;
      `);
      const outerRef = findAllNamedNodes(analysis.program, "Identifier", "blocked").find(
        (node) => node.parent?.type === "ExpressionStatement",
      )!;
      expect(analysis.symbolFor(outerRef)).toBeNull();
    });

    it("function parameter shadows outer binding", () => {
      const analysis = analyze(`
        const x = "outer";
        function fn(x) { return x; }
      `);
      const refs = findAllNamedNodes(analysis.program, "Identifier", "x");
      const insideFn = refs.find((node) => node.parent?.type === "ReturnStatement")!;
      const symbol = analysis.symbolFor(insideFn);
      expect(symbol?.kind).toBe("parameter");
    });
  });

  describe("parameter expression environments", () => {
    it.each([
      "function named(value = named) { var named; return value; }",
      "function named(value = named) { return named; }",
      "function named() { return named; }",
    ])("resolves declaration self references to the outer mutable binding: %s", (functionCode) => {
      const analysis = analyze(`${functionCode} named = () => "replacement";`);
      const declarationSymbol = analysis.rootScope.symbolsByName.get("named")!;
      const declarationScope = analysis.ownScopeFor(declarationSymbol.declarationNode)!;
      const reads = declarationSymbol.references.filter((reference) => reference.flag === "read");

      expect(reads.length).toBeGreaterThan(0);
      expect(declarationSymbol.references.some((reference) => reference.flag === "write")).toBe(
        true,
      );
      expect(declarationScope.symbolsByName.get("named")).toBeUndefined();
      expect(analysis.symbolFor(declarationSymbol.bindingIdentifier)?.id).toBe(
        declarationSymbol.id,
      );
      for (const reference of reads) {
        expect(analysis.symbolFor(reference.identifier)?.id).toBe(declarationSymbol.id);
      }
    });

    it("preserves parameter shadowing of a declaration name in defaults and the body", () => {
      const analysis = analyze(`
        function named(named, capture = () => named) { return named; }
        named = () => "replacement";
      `);
      const declarationSymbol = analysis.rootScope.symbolsByName.get("named")!;
      const parameterSymbol = analysis
        .ownScopeFor(declarationSymbol.declarationNode)!
        .symbolsByName.get("named")!;
      const shadowedReferences = findAllNamedNodes(analysis.program, "Identifier", "named").filter(
        (identifier) =>
          identifier.parent?.type === "ReturnStatement" ||
          identifier.parent?.type === "ArrowFunctionExpression",
      );

      expect(parameterSymbol.kind).toBe("parameter");
      for (const reference of shadowedReferences) {
        expect(analysis.symbolFor(reference)?.id).toBe(parameterSymbol.id);
      }
    });

    it.each([
      "function change(unused = NativeObject.assign) { var NativeObject; }",
      "function change(unused = NativeObject.assign) { function NativeObject() {} }",
      "function change(unused = NativeObject.assign) { let NativeObject; }",
      "function change(unused = NativeObject.assign) { class NativeObject {} }",
      "function change(unused = () => NativeObject.assign) { var NativeObject; }",
      "function change(unused = function (inner = NativeObject.assign) { var NativeObject; }) { var NativeObject; }",
      "function change({ value = NativeObject.assign }) { var NativeObject; }",
      "function change([value = NativeObject.assign]) { var NativeObject; }",
      "function change({ [NativeObject.assign]: value }) { var NativeObject; }",
      "const change = (unused = NativeObject.assign) => { var NativeObject; };",
      "const change = function (unused = NativeObject.assign) { var NativeObject; };",
      "const change = { method(unused = NativeObject.assign) { var NativeObject; } };",
      "class Change { method(unused = NativeObject.assign) { var NativeObject; } }",
      "function change(unused = NativeObject.assign) { { var NativeObject; } }",
      "function change(unused = NativeObject.assign) { try {} catch (error) { var NativeObject; } }",
    ])("resolves the outer alias before body declarations: %s", (functionCode) => {
      const analysis = analyze(`const NativeObject = Object; ${functionCode}`);
      const aliasReference = findAllNamedNodes(analysis.program, "Identifier", "NativeObject").find(
        (identifier) => identifier.parent?.type === "MemberExpression",
      )!;

      expect(analysis.symbolFor(aliasReference)?.id).toBe(
        analysis.rootScope.symbolsByName.get("NativeObject")?.id,
      );
    });

    it.each(["Object", "Array", "globalThis"])(
      "preserves global references in defaults despite body var %s",
      (globalName) => {
        const analysis = analyze(
          `function change(unused = ${globalName}.property) { var ${globalName}; }`,
        );
        const globalReference = findAllNamedNodes(analysis.program, "Identifier", globalName).find(
          (identifier) => identifier.parent?.type === "MemberExpression",
        )!;

        expect(analysis.isGlobalReference(globalReference)).toBe(true);
      },
    );

    it("keeps parameter closures on the parameter binding when a body var copies its name", () => {
      const analysis = analyze(`
        function change(value = "parameter", capture = () => value) {
          var value = "body";
          return value;
        }
      `);
      const references = findAllNamedNodes(analysis.program, "Identifier", "value");
      const parameterReference = references.find(
        (identifier) => identifier.parent?.type === "ArrowFunctionExpression",
      )!;
      const bodyReference = references.find(
        (identifier) => identifier.parent?.type === "ReturnStatement",
      )!;
      const parameterSymbol = analysis.symbolFor(parameterReference)!;
      const bodySymbol = analysis.symbolFor(bodyReference)!;

      expect(parameterSymbol.kind).toBe("parameter");
      expect(bodySymbol.kind).toBe("var");
      expect(bodySymbol.id).not.toBe(parameterSymbol.id);
      expect(bodySymbol.scope.parent?.id).toBe(parameterSymbol.scope.id);
    });

    it("does not fabricate a parameter initializer for a copied body var", () => {
      const analysis = analyze(`function change(value = Object) { var value; return value; }`);
      const bodyReference = findAllNamedNodes(analysis.program, "Identifier", "value").find(
        (identifier) => identifier.parent?.type === "ReturnStatement",
      )!;

      expect(analysis.symbolFor(bodyReference)?.initializer).toBeNull();
      expect(analysis.symbolFor(bodyReference)?.kind).toBe("var");
    });

    it.each(["value", "...value", "{ value }", "[value]"])(
      "preserves a shared parameter and body scope without expressions: %s",
      (parameterPattern) => {
        const analysis = analyze(
          `function change(${parameterPattern}) { var value; return value; }`,
        );
        const functionNode = findFirstNamedNode(analysis.program, "FunctionDeclaration")!;
        const bodyReference = findAllNamedNodes(analysis.program, "Identifier", "value").find(
          (identifier) => identifier.parent?.type === "ReturnStatement",
        )!;
        const functionScope = analysis.ownScopeFor(functionNode)!;

        expect(analysis.scopeFor(bodyReference).id).toBe(functionScope.id);
        expect(functionScope.children).toHaveLength(0);
      },
    );

    it("preserves named function-expression self references in defaults", () => {
      const analysis = analyze(
        `const change = function self(value = self) { var self; return self; };`,
      );
      const functionNode = findFirstNamedNode(analysis.program, "FunctionExpression")!;
      const selfReferences = findAllNamedNodes(analysis.program, "Identifier", "self");
      const defaultReference = selfReferences.find(
        (identifier) => identifier.parent?.type === "AssignmentPattern",
      )!;
      const bodyReference = selfReferences.find(
        (identifier) => identifier.parent?.type === "ReturnStatement",
      )!;

      expect(analysis.symbolFor(defaultReference)?.kind).toBe("function");
      expect(analysis.symbolFor(defaultReference)?.scope.id).toBe(
        analysis.ownScopeFor(functionNode)?.id,
      );
      expect(analysis.symbolFor(bodyReference)?.kind).toBe("var");
    });

    it("keeps all parameter bindings visible to defaults and body references", () => {
      const analysis = analyze(`function change(value = later, later = value) { return value; }`);
      const functionNode = findFirstNamedNode(analysis.program, "FunctionDeclaration")!;
      const parameterScope = analysis.ownScopeFor(functionNode)!;
      for (const name of ["value", "later"]) {
        const references = findAllNamedNodes(analysis.program, "Identifier", name).filter(
          (identifier) => analysis.referenceFor(identifier),
        );
        for (const reference of references) {
          expect(analysis.symbolFor(reference)?.id).toBe(
            parameterScope.symbolsByName.get(name)?.id,
          );
          expect(analysis.symbolFor(reference)?.kind).toBe("parameter");
        }
      }
    });

    it("resolves an enclosing catch binding before body var declarations", () => {
      const analysis = analyze(`
        try {} catch (NativeObject) {
          function change(value = NativeObject.assign) { var NativeObject; }
        }
      `);
      const aliasReference = findAllNamedNodes(analysis.program, "Identifier", "NativeObject").find(
        (identifier) => identifier.parent?.type === "MemberExpression",
      )!;

      expect(analysis.symbolFor(aliasReference)?.kind).toBe("catch-clause-parameter");
    });

    it("preserves shadowing inside a function created by a parameter expression", () => {
      const analysis = analyze(`
        const NativeObject = Object;
        function change(value = () => { var NativeObject; return NativeObject; }) {
          var NativeObject;
        }
      `);
      const nestedReference = findAllNamedNodes(
        analysis.program,
        "Identifier",
        "NativeObject",
      ).find((identifier) => identifier.parent?.type === "ReturnStatement")!;

      expect(analysis.symbolFor(nestedReference)?.kind).toBe("var");
      expect(analysis.symbolFor(nestedReference)?.scope.kind).toBe("arrow-function");
    });
  });

  describe("scopeFor", () => {
    it("returns the function scope for a node inside a function body", () => {
      const analysis = analyze(`function fn() { const x = 1; }`);
      const decl = findFirstNamedNode(analysis.program, "VariableDeclaration")!;
      const scope = analysis.scopeFor(decl);
      expect(scope.kind).toBe("function");
    });

    it("returns the module scope for a top-level node", () => {
      const analysis = analyze(`const x = 1;`);
      const decl = findFirstNamedNode(analysis.program, "VariableDeclaration")!;
      const scope = analysis.scopeFor(decl);
      expect(scope.kind).toBe("module");
    });
  });

  describe("non-reference positions", () => {
    it("does not record binding identifiers as references", () => {
      const analysis = analyze(`
        import Default, { value as alias } from "source";
        const { first, nested: { second }, ...rest } = input;
        function named(parameter, { option }) {
          class Inner {}
          try {} catch (error) {}
        }
        namespace Example {}
      `);
      const scopes = [analysis.rootScope];
      for (const scope of scopes) {
        scopes.push(...scope.children);
        for (const symbol of scope.symbols) {
          expect(analysis.referenceFor(symbol.bindingIdentifier)).toBeNull();
        }
      }
    });

    it("does not record `obj.foo` as a reference to foo", () => {
      const analysis = analyze(`obj.foo;`);
      const refs = findAllNamedNodes(analysis.program, "Identifier", "foo");
      expect(refs).toHaveLength(1);
      expect(analysis.referenceFor(refs[0]!)).toBeNull();
    });

    it("does record obj as a reference", () => {
      const analysis = analyze(`obj.foo;`);
      const refs = findAllNamedNodes(analysis.program, "Identifier", "obj");
      expect(refs).toHaveLength(1);
      expect(analysis.referenceFor(refs[0]!)).toBeDefined();
    });

    it("treats { foo } shorthand as a reference", () => {
      const analysis = analyze(`const a = 1; const b = { a };`);
      const inObject = findAllNamedNodes(analysis.program, "Identifier", "a").find((node) => {
        const parent = node.parent;
        return parent?.type === "Property" && (parent as { shorthand: boolean }).shorthand;
      })!;
      expect(analysis.symbolFor(inObject)?.kind).toBe("const");
    });
  });

  describe("decorators", () => {
    it("supports host class nodes without a decorators property", () => {
      const parsed = parseFixture("class Example { method() {} }");
      const classDeclaration = findFirstNamedNode(parsed.program, "ClassDeclaration")!;
      Reflect.deleteProperty(classDeclaration, "decorators");
      attachParentReferences(parsed.program);

      expect(() => analyzeScopes(parsed.program)).not.toThrow();
    });

    it("resolves parameter decorators outside the parameter scope", () => {
      const analysis = analyze(`
        import { useEffect } from "react";
        class Example {
          method(@useEffect() useEffect: unknown) {}
        }
      `);
      const decoratorReference = findAllNamedNodes(
        analysis.program,
        "Identifier",
        "useEffect",
      ).find((identifier) => identifier.parent?.type === "CallExpression")!;

      expect(analysis.symbolFor(decoratorReference)?.kind).toBe("import");
    });
  });

  describe("TypeScript declarations", () => {
    it("binds enum / type / interface / module names", () => {
      const { rootScope } = analyze(`
        enum E { A, B }
        type T = number;
        interface I {}
        namespace N {}
      `);
      expect(rootScope.symbolsByName.get("E")?.kind).toBe("ts-enum");
      expect(rootScope.symbolsByName.get("T")?.kind).toBe("ts-type-alias");
      expect(rootScope.symbolsByName.get("I")?.kind).toBe("ts-interface");
      expect(rootScope.symbolsByName.get("N")?.kind).toBe("ts-module");
    });
  });

  describe("JSX identifiers", () => {
    it("treats lowercase JSXIdentifier as an HTML tag (not a reference)", () => {
      const analysis = analyze(`<div />;`);
      const ids = findAllNamedNodes(analysis.program, "JSXIdentifier", "div");
      for (const id of ids) {
        expect(analysis.referenceFor(id)).toBeNull();
      }
    });

    it("treats PascalCase JSXIdentifier as a reference", () => {
      const analysis = analyze(`
        const App = () => null;
        <App />;
      `);
      const ids = findAllNamedNodes(analysis.program, "JSXIdentifier", "App");
      const inJsx = ids[0]!;
      expect(analysis.symbolFor(inJsx)?.kind).toBe("const");
    });
  });
});
