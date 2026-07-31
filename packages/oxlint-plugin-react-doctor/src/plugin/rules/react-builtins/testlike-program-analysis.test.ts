import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { jsxNoConstructedContextValues } from "./jsx-no-constructed-context-values.js";
import { jsxNoJsxAsProp } from "./jsx-no-jsx-as-prop.js";
import { jsxNoNewArrayAsProp } from "./jsx-no-new-array-as-prop.js";
import { jsxNoNewFunctionAsProp } from "./jsx-no-new-function-as-prop.js";
import { jsxNoNewObjectAsProp } from "./jsx-no-new-object-as-prop.js";

const TESTLIKE_GATED_RULES = [
  jsxNoConstructedContextValues,
  jsxNoJsxAsProp,
  jsxNoNewArrayAsProp,
  jsxNoNewFunctionAsProp,
  jsxNoNewObjectAsProp,
];

describe("testlike Program analysis gates", () => {
  for (const rule of TESTLIKE_GATED_RULES) {
    it(`${rule.id} skips whole-file setup`, () => {
      const program = parseFixture(`const Component = () => <div />;`).program;
      let programBodyReadCount = 0;
      const protectedProgram = new Proxy(program, {
        get(target, property, receiver) {
          if (property === "body") programBodyReadCount += 1;
          return Reflect.get(target, property, receiver);
        },
      });
      let didReadScopes = false;
      const visitors = rule.create({
        filename: "component.test.tsx",
        report: () => {},
        get scopes(): never {
          didReadScopes = true;
          throw new Error("scopes should stay lazy");
        },
        get cfg(): never {
          throw new Error("cfg should stay lazy");
        },
      });

      expect(() => visitors.Program(protectedProgram)).not.toThrow();
      expect(programBodyReadCount).toBe(1);
      expect(didReadScopes).toBe(false);
    });
  }
});
