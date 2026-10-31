import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { collectUseStateBindings } from "./collect-use-state-bindings.js";
import { isLocalLiteralStateInitializer } from "./is-local-literal-state-initializer.js";

describe("local literal initializer cache context", () => {
  it.each([false, true])(
    "keeps binding membership separate when full context first=%s",
    (fullContextFirst) => {
      const parsed = parseFixture(
        'import {useState}from"react";function Panel(){const initial={count:0};const[first,setFirst]=useState(initial);const[second,setSecond]=useState(initial);}',
      );
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      if (!isNodeOfType(parsed.program, "Program")) throw new Error("Missing program");
      const component = parsed.program.body[1];
      if (!isNodeOfType(component, "FunctionDeclaration")) throw new Error("Missing component");
      const scopes = analyzeScopes(parsed.program);
      const bindings = collectUseStateBindings(component.body, scopes);
      expect(bindings).toHaveLength(2);
      const selectedCall = bindings[0]?.declarator.init;
      if (!isNodeOfType(selectedCall, "CallExpression")) throw new Error("Missing state call");
      const partialBindings = bindings.slice(0, 1);
      for (const useFullContext of [fullContextFirst, !fullContextFirst, fullContextFirst]) {
        expect(
          isLocalLiteralStateInitializer(
            selectedCall.arguments[0],
            component.body,
            useFullContext ? bindings : partialBindings,
            scopes,
          ),
        ).toBe(useFullContext);
      }
    },
  );
});
