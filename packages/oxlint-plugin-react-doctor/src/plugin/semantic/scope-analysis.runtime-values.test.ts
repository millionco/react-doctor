import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "../utils/es-tree-node.js";
import { walkAst } from "../utils/walk-ast.js";
import { analyzeScopes } from "./scope-analysis.js";
import type {
  ReferenceDescriptor,
  ReferenceFlag,
  SymbolDescriptor,
  SymbolKind,
} from "./scope-analysis.js";

interface RuntimeResolutionCase {
  name: string;
  code: string;
  expectedKind: SymbolKind | null;
  flags: ReferenceFlag[];
}

const cases: RuntimeResolutionCase[] = [
  {
    name: "destructured parameter beneath interface",
    code: "function read({subject}){interface subject{} consume(subject);}",
    expectedKind: "parameter",
    flags: ["read"],
  },
  {
    name: "computed key const beneath interface",
    code: "const subject='useState'; interface subject{} Object.defineProperty(React,subject,{});",
    expectedKind: "const",
    flags: ["read"],
  },
  {
    name: "const before interface",
    code: "const subject=1; interface subject{} consume(subject);",
    expectedKind: "const",
    flags: ["read"],
  },
  {
    name: "interface before const",
    code: "interface subject{} const subject=1; consume(subject);",
    expectedKind: "const",
    flags: ["read"],
  },
  {
    name: "const before type alias",
    code: "const subject=1; type subject=unknown; consume(subject);",
    expectedKind: "const",
    flags: ["read"],
  },
  {
    name: "outer const beneath inner interface",
    code: "const subject=1; function read(){interface subject{} consume(subject);}",
    expectedKind: "const",
    flags: ["read"],
  },
  {
    name: "outer const beneath inner type alias",
    code: "const subject=1; function read(){type subject=unknown; consume(subject);}",
    expectedKind: "const",
    flags: ["read"],
  },
  {
    name: "outer const beneath empty namespace",
    code: "const subject=1; namespace Outer{namespace subject{} consume(subject);}",
    expectedKind: "const",
    flags: ["read"],
  },
  {
    name: "outer const beneath type-only namespace",
    code: "const subject=1; namespace Outer{namespace subject{export interface Marker{}} consume(subject);}",
    expectedKind: "const",
    flags: ["read"],
  },
  {
    name: "outer const beneath ambient value",
    code: "const subject=1; function read(){declare const subject:unknown; consume(subject);}",
    expectedKind: "const",
    flags: ["read"],
  },
  {
    name: "parameter beneath inner interface",
    code: "function read(subject){interface subject{} consume(subject);}",
    expectedKind: "parameter",
    flags: ["read"],
  },
  {
    name: "parameter beneath inner type alias",
    code: "function read(subject){type subject=unknown; consume(subject);}",
    expectedKind: "parameter",
    flags: ["read"],
  },
  {
    name: "parameter writes beneath interface",
    code: "function read(subject){interface subject{} subject=2; consume(subject);}",
    expectedKind: "parameter",
    flags: ["write", "read"],
  },
  {
    name: "nested parameter writes beneath interface",
    code: "function read(subject){function update(){interface subject{} subject+=2;} consume(subject);}",
    expectedKind: "parameter",
    flags: ["read-write", "read"],
  },
  {
    name: "nearest real parameter shadows outer const",
    code: "const subject=1; function read(subject){interface subject{} consume(subject);}",
    expectedKind: "parameter",
    flags: ["read"],
  },
  {
    name: "default import beneath interface",
    code: "import subject from 'provider'; interface subject{} consume(subject);",
    expectedKind: "import",
    flags: ["read"],
  },
  {
    name: "namespace import beneath nested interface",
    code: "import * as subject from 'provider'; function read(){interface subject{} consume(subject);}",
    expectedKind: "import",
    flags: ["read"],
  },
  {
    name: "named import beneath nested type alias",
    code: "import {subject} from 'provider'; function read(){type subject=unknown; consume(subject);}",
    expectedKind: "import",
    flags: ["read"],
  },
  {
    name: "named import beneath type-only namespace",
    code: "import {subject} from 'provider'; namespace Outer{namespace subject{export type Marker=unknown;} consume(subject);}",
    expectedKind: "import",
    flags: ["read"],
  },
  {
    name: "import write beneath nested interface",
    code: "import {subject} from 'provider'; function update(){interface subject{} subject=other;}",
    expectedKind: "import",
    flags: ["write"],
  },
  {
    name: "function beneath merged interface",
    code: "function subject(){} interface subject{} consume(subject);",
    expectedKind: "function",
    flags: ["read"],
  },
  {
    name: "class beneath merged interface",
    code: "class subject{} interface subject{} consume(subject);",
    expectedKind: "class",
    flags: ["read"],
  },
  {
    name: "runtime namespace beneath interface",
    code: "namespace subject{export const present=1;} interface subject{} consume(subject);",
    expectedKind: "ts-module",
    flags: ["read"],
  },
  {
    name: "latest real var declaration wins",
    code: "var subject; var subject; interface subject{} consume(subject);",
    expectedKind: "var",
    flags: ["read"],
  },
  {
    name: "value import-equals stays runtime",
    code: "import subject=require('provider'); interface subject{} consume(subject);",
    expectedKind: "ts-import-equals",
    flags: ["read"],
  },
  {
    name: "interface-only fallback stays bound",
    code: "interface subject{} consume(subject);",
    expectedKind: "ts-interface",
    flags: ["read"],
  },
  {
    name: "nearest erased fallback stays bound",
    code: "type subject=unknown; function read(){interface subject{} consume(subject);}",
    expectedKind: "ts-interface",
    flags: ["read"],
  },
  {
    name: "type-alias-only fallback stays bound",
    code: "type subject=unknown; consume(subject);",
    expectedKind: "ts-type-alias",
    flags: ["read"],
  },
  {
    name: "type-only import fallback stays bound",
    code: "import type {subject} from 'provider'; consume(subject);",
    expectedKind: "import",
    flags: ["read"],
  },
  {
    name: "type-only import-equals fallback stays bound",
    code: "import type subject=require('provider'); consume(subject);",
    expectedKind: "ts-import-equals",
    flags: ["read"],
  },
  {
    name: "ambient-only fallback stays bound",
    code: "declare const subject:unknown; consume(subject);",
    expectedKind: "const",
    flags: ["read"],
  },
  {
    name: "empty namespace fallback stays bound",
    code: "namespace subject{} consume(subject);",
    expectedKind: "ts-module",
    flags: ["read"],
  },
  {
    name: "type-only namespace fallback stays bound",
    code: "namespace subject{export type Marker=unknown;} consume(subject);",
    expectedKind: "ts-module",
    flags: ["read"],
  },
  {
    name: "unrelated inner values do not replace erased fallback",
    code: "interface subject{} function unrelated(){const subject=1;} consume(subject);",
    expectedKind: "ts-interface",
    flags: ["read"],
  },
  {
    name: "unbound value stays global",
    code: "consume(subject);",
    expectedKind: null,
    flags: ["read"],
  },
];

describe("runtime reference resolution across erased declarations", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const parsed = parseFixture(scenario.code);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const analysis = analyzeScopes(parsed.program);
      const references: ReferenceDescriptor[] = [];
      walkAst(parsed.program, (node) => {
        if (node.type !== "Identifier" || node.name !== "subject") return;
        const reference = analysis.referenceFor(node);
        if (reference) references.push(reference);
      });
      expect(references.map((reference) => reference.flag)).toEqual(scenario.flags);
      const resolved = references[0]?.resolvedSymbol ?? null;
      expect(resolved?.kind ?? null).toBe(scenario.expectedKind);
      for (const reference of references) {
        expect(analysis.symbolFor(reference.identifier)).toBe(resolved);
        expect(analysis.isGlobalReference(reference.identifier)).toBe(resolved === null);
        if (resolved) expect(resolved.references).toContain(reference);
      }
      const bindingsByIdentifier = new Map<EsTreeNode, SymbolDescriptor>();
      const pending = [analysis.rootScope];
      while (pending.length) {
        const scope = pending.pop();
        if (!scope) continue;
        pending.push(...scope.children);
        for (const binding of scope.symbols) {
          const previous = bindingsByIdentifier.get(binding.bindingIdentifier);
          if (!previous || previous.id < binding.id)
            bindingsByIdentifier.set(binding.bindingIdentifier, binding);
          expect(scope.symbolsByName.get(binding.name)?.id).toBe(
            scope.symbols.filter((symbol) => symbol.name === binding.name).at(-1)?.id,
          );
        }
      }
      for (const [identifier, binding] of bindingsByIdentifier)
        expect(analysis.symbolFor(identifier)?.id).toBe(binding.id);
    });
  }
});
