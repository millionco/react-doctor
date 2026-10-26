import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { parseSourceText } from "./parse-source-file.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";
import {
  hasPossibleStaticPropertyMutationOrEscape,
  hasPossibleStaticPropertyMutationOrEscapeBefore,
  hasStaticPropertyWriteBefore,
} from "./has-static-property-write-before.js";
interface StaticPropertyReferenceCase {
  readonly name: string;
  readonly statement: string;
  readonly trailing?: string;
  readonly expectedAllReferences: boolean;
  readonly expectedBeforeRead: boolean;
}
const cases: ReadonlyArray<StaticPropertyReferenceCase> = [
  {
    name: "readonly Namespace",
    statement: "const value=Namespace.version;",
    expectedAllReferences: false,
    expectedBeforeRead: false,
  },
  {
    name: "readonly plain parentheses",
    statement: "const value=((Namespace)).version;",
    expectedAllReferences: false,
    expectedBeforeRead: false,
  },
  {
    name: "readonly (Namespace as object)",
    statement: "const value=(Namespace as object).version;",
    expectedAllReferences: false,
    expectedBeforeRead: false,
  },
  {
    name: "readonly Namespace!",
    statement: "const value=Namespace!.version;",
    expectedAllReferences: false,
    expectedBeforeRead: false,
  },
  {
    name: "readonly (Namespace satisfies object)",
    statement: "const value=(Namespace satisfies object).version;",
    expectedAllReferences: false,
    expectedBeforeRead: false,
  },
  {
    name: "readonly (<object>Namespace)",
    statement: "const value=(<object>Namespace).version;",
    expectedAllReferences: false,
    expectedBeforeRead: false,
  },
  {
    name: "write",
    statement: "(Namespace as object).read = replacement;",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "delete",
    statement: "delete (Namespace as object).read;",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "update",
    statement: "(Namespace as any).read++;",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "alias write",
    statement: "const alternate=(Namespace as object);alternate.read=replacement;",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "namespace escape",
    statement: "consume((Namespace as object));",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "wrapped unknown method",
    statement: "(Namespace as object).configure();",
    expectedAllReferences: false,
    expectedBeforeRead: true,
  },
  {
    name: "bare unknown method",
    statement: "Namespace.configure();",
    expectedAllReferences: false,
    expectedBeforeRead: true,
  },
  {
    name: "later wrapped write",
    statement: "",
    trailing: "(Namespace as object).read=replacement;",
    expectedAllReferences: true,
    expectedBeforeRead: false,
  },
  {
    name: "outer-wrapped assignment",
    statement: "((Namespace as any).read as any)=replacement;",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "outer-wrapped delete",
    statement: "delete ((Namespace as any).read as any);",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "outer-wrapped update",
    statement: "((Namespace as any).read as any)++;",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "object destructuring target",
    statement: "({value:(Namespace as any).read}=payload);",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "array destructuring target",
    statement: "[(Namespace as any).read]=values;",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "for-of target",
    statement: "for ((Namespace as any).read of values) {}",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "for-in target",
    statement: "for ((Namespace as any).read in values) {}",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "array rest target",
    statement: "[...(Namespace as any).read]=values;",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
  {
    name: "destructuring default target",
    statement: "({value:(Namespace as any).read=replacement}=payload);",
    expectedAllReferences: true,
    expectedBeforeRead: true,
  },
];
describe("transparent static property references", () => {
  for (const testCase of cases)
    for (const parserProfile of ["fixture", "cross-file"])
      for (const phase of ["all", "before-read"])
        it(`${testCase.name} (${parserProfile}, ${phase})`, () => {
          const source = `import * as Namespace from "client";${testCase.statement}Namespace.read();${testCase.trailing ?? ""}`;
          const parsed = parseFixture(source, { filename: "fixture.ts" });
          expect(parsed.errors).toEqual([]);
          const program =
            parserProfile === "fixture"
              ? parsed.program
              : parseSourceText({ filename: "fixture.ts", sourceText: source });
          if (!program) throw new Error("Expected the namespace fixture to parse");
          attachParentReferences(program);
          const scopes = analyzeScopes(program);
          let observations = 0;
          walkAst(program, (node) => {
            if (
              !isNodeOfType(node, "CallExpression") ||
              !isNodeOfType(node.callee, "MemberExpression") ||
              !isNodeOfType(node.callee.property, "Identifier") ||
              node.callee.property.name !== "read"
            )
              return;
            const identifier = getRootIdentifier(node.callee);
            if (!identifier) throw new Error("Expected the imported namespace receiver");
            const actual =
              phase === "all"
                ? hasPossibleStaticPropertyMutationOrEscape(identifier, "read", scopes)
                : hasPossibleStaticPropertyMutationOrEscapeBefore(identifier, "read", node, scopes);
            expect(actual).toBe(
              phase === "all" ? testCase.expectedAllReferences : testCase.expectedBeforeRead,
            );
            observations += 1;
          });
          expect(observations).toBe(1);
        });
});

interface DefinitePropertyWriteCase {
  readonly name: string;
  readonly statement: string;
  readonly expected: boolean;
}
const definiteCases: ReadonlyArray<DefinitePropertyWriteCase> = [
  {
    name: "direct assignment RHS",
    statement: "Namespace.read=Namespace.read();",
    expected: false,
  },
  {
    name: "compound assignment RHS",
    statement: "Namespace.read+=Namespace.read();",
    expected: false,
  },
  {
    name: "assignment RHS sequence",
    statement: "Namespace.read=(Namespace.read(),replacement);",
    expected: false,
  },
  {
    name: "assignment RHS argument",
    statement: "Namespace.read=consume(Namespace.read());",
    expected: false,
  },
  {
    name: "awaited assignment RHS",
    statement: "async function run(){Namespace.read=await Namespace.read();}",
    expected: false,
  },
  {
    name: "read following completed write in sequence",
    statement: "consume((Namespace.read=replacement),Namespace.read());",
    expected: true,
  },
  {
    name: "read inside assigned deferred function",
    statement: "Namespace.read=()=>Namespace.read();",
    expected: false,
  },
  {
    name: "prior direct update",
    statement: "Namespace.read++;Namespace.read();",
    expected: true,
  },
  {
    name: "prior direct delete",
    statement: "delete Namespace.read;Namespace.read();",
    expected: true,
  },
  {
    name: "outer-wrapped assignment RHS",
    statement: "((Namespace as any).read as any)=Namespace.read();",
    expected: false,
  },
  {
    name: "object destructuring RHS",
    statement: "({value:(Namespace as any).read}={value:Namespace.read()});",
    expected: false,
  },
  {
    name: "array destructuring RHS",
    statement: "[(Namespace as any).read]=[Namespace.read()];",
    expected: false,
  },
  {
    name: "destructuring default RHS",
    statement: "({value:(Namespace as any).read=Namespace.read()}={});",
    expected: false,
  },
  {
    name: "for-of iterable before write",
    statement: "for ((Namespace as any).read of Namespace.read()) {}",
    expected: false,
  },
  {
    name: "prior direct write",
    statement: "Namespace.read=replacement;Namespace.read();",
    expected: true,
  },
  {
    name: "later direct write",
    statement: "Namespace.read();Namespace.read=replacement;",
    expected: false,
  },
  {
    name: "prior direct write with wrapped receiver",
    statement: "(Namespace as any).read=replacement;Namespace.read();",
    expected: true,
  },
];
describe("direct definite property-write boundaries", () => {
  for (const testCase of definiteCases)
    for (const parserProfile of ["fixture", "cross-file"])
      it(`${testCase.name} (${parserProfile})`, () => {
        const source = `const Namespace={read:()=>0};${testCase.statement}`;
        const parsed = parseFixture(source, { filename: "fixture.ts" });
        expect(parsed.errors).toEqual([]);
        const program =
          parserProfile === "fixture"
            ? parsed.program
            : parseSourceText({ filename: "fixture.ts", sourceText: source });
        if (!program) throw new Error("Expected the definite-write fixture to parse");
        attachParentReferences(program);
        const scopes = analyzeScopes(program);
        let observations = 0;
        walkAst(program, (node) => {
          if (
            !isNodeOfType(node, "CallExpression") ||
            !isNodeOfType(node.callee, "MemberExpression") ||
            !isNodeOfType(node.callee.property, "Identifier") ||
            node.callee.property.name !== "read"
          )
            return;
          const identifier = getRootIdentifier(node.callee);
          if (!identifier) throw new Error("Expected a namespace receiver");
          expect(hasStaticPropertyWriteBefore(identifier, "read", node, scopes)).toBe(
            testCase.expected,
          );
          observations += 1;
        });
        expect(observations).toBe(1);
      });
});
