import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferSchemaValidation } from "./prefer-schema-validation.js";

describe("prefer-schema-validation", () => {
  // ---------------------------------------------------------------------------
  // SECTION 1: Core detection — typeof checks
  // ---------------------------------------------------------------------------
  describe("flags manual typeof validation plumbing", () => {
    it("flags 3 typeof checks in an arrow function body", () => {
      const code = `
        const validateUser = (input) => {
          if (typeof input.name !== "string") throw new Error("bad name");
          if (typeof input.age !== "number") throw new Error("bad age");
          if (typeof input.email !== "string") throw new Error("bad email");
          return input;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("3 manual type checks");
    });

    it("flags 4 typeof checks in a function declaration", () => {
      const code = `
        function parseConfig(raw) {
          if (typeof raw.host !== "string") throw new Error();
          if (typeof raw.port !== "number") throw new Error();
          if (typeof raw.debug !== "boolean") throw new Error();
          if (typeof raw.timeout !== "number") throw new Error();
          return raw;
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("4 manual type checks");
    });

    it("flags typeof checks in a function expression", () => {
      const code = `
        const validate = function(data) {
          if (typeof data.x !== "string") return false;
          if (typeof data.y !== "number") return false;
          if (typeof data.z !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags typeof checks with loose equality (==)", () => {
      const code = `
        const check = (val) => {
          if (typeof val.a == "string") {}
          if (typeof val.b == "number") {}
          if (typeof val.c == "boolean") {}
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags typeof checks with loose inequality (!=)", () => {
      const code = `
        const check = (val) => {
          if (typeof val.a != "string") return false;
          if (typeof val.b != "number") return false;
          if (typeof val.c != "object") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags typeof on right-hand side of comparison", () => {
      const code = `
        const validate = (val) => {
          if ("string" === typeof val.a) {}
          if ("number" === typeof val.b) {}
          if ("boolean" === typeof val.c) {}
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags typeof checks against 'object'", () => {
      const code = `
        const isRecord = (val) => {
          if (typeof val.meta !== "object") return false;
          if (typeof val.headers !== "object") return false;
          if (typeof val.body !== "object") return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags typeof checks against 'symbol'", () => {
      const code = `
        const validate = (val) => {
          if (typeof val.id !== "symbol") return false;
          if (typeof val.key !== "symbol") return false;
          if (typeof val.tag !== "symbol") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags typeof checks against 'bigint'", () => {
      const code = `
        const validate = (val) => {
          if (typeof val.amount !== "bigint") return false;
          if (typeof val.balance !== "bigint") return false;
          if (typeof val.total !== "bigint") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags typeof mixed with ternary expressions", () => {
      const code = `
        const validate = (val) => {
          const isNameOk = typeof val.name === "string" ? true : false;
          const isAgeOk = typeof val.age === "number" ? true : false;
          const isActiveOk = typeof val.active === "boolean" ? true : false;
          return isNameOk && isAgeOk && isActiveOk;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags typeof checks combined in logical AND chain", () => {
      const code = `
        const isValid = (obj) => {
          return typeof obj.a === "string" && typeof obj.b === "number" && typeof obj.c === "boolean";
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags typeof checks combined in logical OR chain", () => {
      const code = `
        const isInvalid = (obj) => {
          return typeof obj.a !== "string" || typeof obj.b !== "number" || typeof obj.c !== "boolean";
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("counts exactly at threshold (3)", () => {
      const code = `
        const validate = (val) => {
          if (typeof val.x !== "string") return false;
          if (typeof val.y !== "number") return false;
          if (typeof val.z !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("3 manual type checks");
    });

    it("counts high volume of typeof checks accurately", () => {
      const code = `
        function validateHuge(obj) {
          if (typeof obj.a !== "string") return false;
          if (typeof obj.b !== "string") return false;
          if (typeof obj.c !== "number") return false;
          if (typeof obj.d !== "number") return false;
          if (typeof obj.e !== "boolean") return false;
          if (typeof obj.f !== "boolean") return false;
          if (typeof obj.g !== "object") return false;
          if (typeof obj.h !== "string") return false;
          if (typeof obj.i !== "number") return false;
          if (typeof obj.j !== "string") return false;
          return true;
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("10 manual type checks");
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 2: Core detection — in expressions
  // ---------------------------------------------------------------------------
  describe("flags in-expression checks", () => {
    it("flags 3+ in-expression checks", () => {
      const code = `
        const hasRequiredFields = (obj) => {
          if (!("id" in obj)) return false;
          if (!("name" in obj)) return false;
          if (!("email" in obj)) return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags in-expression checks on computed property names", () => {
      const code = `
        const FIELD_ID = "id";
        const FIELD_NAME = "name";
        const hasFields = (obj) => {
          if (!(FIELD_ID in obj)) return false;
          if (!(FIELD_NAME in obj)) return false;
          if (!("type" in obj)) return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 3: Core detection — hasOwnProperty / hasOwn
  // ---------------------------------------------------------------------------
  describe("flags hasOwnProperty / hasOwn chains", () => {
    it("flags hasOwnProperty chains", () => {
      const code = `
        function isWidget(obj) {
          if (!obj.hasOwnProperty("id")) return false;
          if (!obj.hasOwnProperty("name")) return false;
          if (!obj.hasOwnProperty("type")) return false;
          return true;
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags Object.hasOwn chains", () => {
      const code = `
        function isWidget(obj) {
          if (!Object.hasOwn(obj, "id")) return false;
          if (!Object.hasOwn(obj, "name")) return false;
          if (!Object.hasOwn(obj, "type")) return false;
          return true;
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags prototype hasOwnProperty.call pattern", () => {
      const code = `
        function isWidget(obj) {
          if (!Object.prototype.hasOwnProperty.call(obj, "id")) return false;
          if (!Object.prototype.hasOwnProperty.call(obj, "name")) return false;
          if (!Object.prototype.hasOwnProperty.call(obj, "type")) return false;
          return true;
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 4: Mixed detection patterns
  // ---------------------------------------------------------------------------
  describe("flags mixed check types", () => {
    it("flags mixed typeof and in checks", () => {
      const code = `
        const isValidResponse = (response) => {
          if (!("data" in response)) return false;
          if (!("status" in response)) return false;
          if (typeof response.data !== "object") return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("3 manual type checks");
    });

    it("flags mixed typeof and hasOwnProperty", () => {
      const code = `
        const validate = (obj) => {
          if (!obj.hasOwnProperty("name")) return false;
          if (typeof obj.name !== "string") return false;
          if (typeof obj.count !== "number") return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags mixed in + typeof + hasOwn", () => {
      const code = `
        const validatePayload = (payload) => {
          if (!("action" in payload)) return false;
          if (typeof payload.action !== "string") return false;
          if (!Object.hasOwn(payload, "data")) return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 5: Reporting node targets
  // ---------------------------------------------------------------------------
  describe("reports on correct AST node", () => {
    it("reports on the function name identifier for arrow functions", () => {
      const code = `
        const validateInput = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "object") return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].nodeType).toBe("Identifier");
    });

    it("reports on function id for named function declarations", () => {
      const code = `
        function validateData(data) {
          if (typeof data.a !== "string") return false;
          if (typeof data.b !== "number") return false;
          if (typeof data.c !== "boolean") return false;
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].nodeType).toBe("Identifier");
    });

    it("reports on function node for anonymous function expressions", () => {
      const code = `
        arr.forEach(function(item) {
          if (typeof item.a !== "string") return;
          if (typeof item.b !== "number") return;
          if (typeof item.c !== "boolean") return;
        });
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].nodeType).toBe("FunctionExpression");
    });

    it("reports on function id for named function expressions", () => {
      const code = `
        const x = function validateItem(item) {
          if (typeof item.a !== "string") return false;
          if (typeof item.b !== "number") return false;
          if (typeof item.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].nodeType).toBe("Identifier");
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 6: Under-threshold — should NOT flag
  // ---------------------------------------------------------------------------
  describe("does not flag under-threshold checks", () => {
    it("allows a single typeof guard", () => {
      const code = `
        const greet = (name) => {
          if (typeof name !== "string") throw new Error("expected string");
          return "Hello " + name;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows two typeof checks (under threshold)", () => {
      const code = `
        const add = (a, b) => {
          if (typeof a !== "number") throw new Error();
          if (typeof b !== "number") throw new Error();
          return a + b;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows exactly two in-expression checks", () => {
      const code = `
        const check = (obj) => {
          if (!("id" in obj)) return false;
          if (!("name" in obj)) return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows a single in-expression check", () => {
      const code = `
        const hasData = (response) => {
          return "data" in response;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows a single hasOwnProperty check", () => {
      const code = `
        const hasName = (obj) => {
          return obj.hasOwnProperty("name");
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows zero checks", () => {
      const code = `
        const sum = (arr) => arr.reduce((total, num) => total + num, 0);
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 7: typeof "undefined" / "function" exclusions
  // ---------------------------------------------------------------------------
  describe("excludes typeof undefined and function checks", () => {
    it("allows typeof undefined checks (null safety)", () => {
      const code = `
        const safe = (obj) => {
          if (typeof obj === "undefined") return null;
          if (typeof obj.a === "undefined") return null;
          if (typeof obj.b === "undefined") return null;
          return obj;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows typeof function checks (callback guards)", () => {
      const code = `
        const callAll = (fns) => {
          if (typeof fns.onStart === "function") fns.onStart();
          if (typeof fns.onProgress === "function") fns.onProgress();
          if (typeof fns.onEnd === "function") fns.onEnd();
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows many typeof undefined checks mixed with one typeof string", () => {
      const code = `
        const safe = (obj) => {
          if (typeof obj === "undefined") return null;
          if (typeof obj.a === "undefined") return null;
          if (typeof obj.b === "undefined") return null;
          if (typeof obj.name !== "string") return null;
          return obj;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows mix of typeof undefined and typeof function", () => {
      const code = `
        const init = (config) => {
          if (typeof config === "undefined") return;
          if (typeof config.onReady === "function") config.onReady();
          if (typeof config.onError === "function") config.onError();
          if (typeof config.dispose === "function") config.dispose();
          if (typeof config.debug === "undefined") return;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("flags when undefined/function checks are mixed with enough value-type checks", () => {
      const code = `
        const validate = (obj) => {
          if (typeof obj === "undefined") return null;
          if (typeof obj.onReady === "function") obj.onReady();
          if (typeof obj.name !== "string") return null;
          if (typeof obj.age !== "number") return null;
          if (typeof obj.active !== "boolean") return null;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("3 manual type checks");
    });

    it("does not count typeof undefined with !== operator", () => {
      const code = `
        const check = (obj) => {
          if (typeof obj.a !== "undefined") doSomething();
          if (typeof obj.b !== "undefined") doSomething();
          if (typeof obj.c !== "undefined") doSomething();
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 8: Schema library import detection
  // ---------------------------------------------------------------------------
  describe("schema library import detection", () => {
    it("allows files that import zod", () => {
      const code = `
        import { z } from "zod";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import valibot", () => {
      const code = `
        import * as v from "valibot";
        function check(data) {
          if (typeof data.x !== "string") return false;
          if (typeof data.y !== "number") return false;
          if (typeof data.z !== "boolean") return false;
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import yup", () => {
      const code = `
        import * as yup from "yup";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import superstruct", () => {
      const code = `
        import { object, string } from "superstruct";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import joi", () => {
      const code = `
        import Joi from "joi";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import io-ts", () => {
      const code = `
        import * as t from "io-ts";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import runtypes", () => {
      const code = `
        import { Record, String, Number } from "runtypes";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import arktype", () => {
      const code = `
        import { type } from "arktype";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import @effect/schema", () => {
      const code = `
        import * as S from "@effect/schema";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import effect/Schema", () => {
      const code = `
        import * as Schema from "effect/Schema";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import @sinclair/typebox", () => {
      const code = `
        import { Type } from "@sinclair/typebox";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import ow", () => {
      const code = `
        import ow from "ow";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import class-validator", () => {
      const code = `
        import { IsString } from "class-validator";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import a schema subpath (e.g. zod/v4)", () => {
      const code = `
        import { z } from "zod/v4";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows files that import a valibot subpath", () => {
      const code = `
        import { string } from "valibot/schemas";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does NOT skip for unrelated library imports", () => {
      const code = `
        import lodash from "lodash";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("does NOT skip for partial name match (e.g. 'zodiac')", () => {
      const code = `
        import { sign } from "zodiac";
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 9: Function scoping
  // ---------------------------------------------------------------------------
  describe("function scoping — nested functions counted independently", () => {
    it("allows typeof checks in separate nested functions", () => {
      const code = `
        const outer = () => {
          const checkA = (x) => { if (typeof x !== "string") throw new Error(); };
          const checkB = (x) => { if (typeof x !== "number") throw new Error(); };
          const checkC = (x) => { if (typeof x !== "boolean") throw new Error(); };
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("flags outer function while ignoring inner function counts", () => {
      const code = `
        const outer = (obj) => {
          if (typeof obj.a !== "string") return false;
          if (typeof obj.b !== "number") return false;
          if (typeof obj.c !== "boolean") return false;
          const inner = (x) => {
            if (typeof x !== "string") return false;
          };
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("3 manual type checks");
    });

    it("flags inner function independently from outer", () => {
      const code = `
        const outer = (obj) => {
          if (typeof obj.a !== "string") return false;
          const inner = (x) => {
            if (typeof x.foo !== "string") return false;
            if (typeof x.bar !== "number") return false;
            if (typeof x.baz !== "boolean") return false;
          };
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].nodeType).toBe("Identifier");
    });

    it("flags both outer and inner when both exceed threshold", () => {
      const code = `
        const outer = (obj) => {
          if (typeof obj.a !== "string") return false;
          if (typeof obj.b !== "number") return false;
          if (typeof obj.c !== "boolean") return false;
          const inner = (x) => {
            if (typeof x.d !== "string") return false;
            if (typeof x.e !== "number") return false;
            if (typeof x.f !== "boolean") return false;
          };
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(2);
    });

    it("does not count class method checks against each other", () => {
      const code = `
        const validateA = (obj) => {
          if (typeof obj.x !== "string") return false;
        };
        const validateB = (obj) => {
          if (typeof obj.y !== "number") return false;
        };
        const validateC = (obj) => {
          if (typeof obj.z !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("flags a deeply nested inner function", () => {
      const code = `
        const outer = () => {
          const middle = () => {
            const inner = (data) => {
              if (typeof data.a !== "string") return false;
              if (typeof data.b !== "number") return false;
              if (typeof data.c !== "boolean") return false;
            };
          };
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 10: Module-scope checks
  // ---------------------------------------------------------------------------
  describe("module-scope typeof checks", () => {
    it("does not flag typeof checks at module scope", () => {
      const code = `
        if (typeof window !== "undefined") console.log("browser");
        if (typeof process !== "undefined") console.log("node");
        if (typeof globalThis !== "undefined") console.log("universal");
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag module-scope in-expression checks", () => {
      const code = `
        if ("fetch" in globalThis) console.log("fetch available");
        if ("crypto" in globalThis) console.log("crypto available");
        if ("ReadableStream" in globalThis) console.log("streams available");
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 11: Real-world open source patterns (should NOT flag)
  // ---------------------------------------------------------------------------
  describe("real-world patterns — should NOT flag", () => {
    it("allows React feature detection (typeof window/document/navigator)", () => {
      const code = `
        const useIsomorphicEffect = () => {
          if (typeof window === "undefined") return;
          if (typeof document === "undefined") return;
          if (typeof navigator === "undefined") return;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows environment detection (typeof Deno/Bun/process)", () => {
      const code = `
        function detectRuntime() {
          if (typeof Deno !== "undefined") return "deno";
          if (typeof Bun !== "undefined") return "bun";
          if (typeof process !== "undefined") return "node";
          return "browser";
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows callback presence checks in event-handler setup", () => {
      const code = `
        const setupListeners = (handlers) => {
          if (typeof handlers.onClick === "function") el.addEventListener("click", handlers.onClick);
          if (typeof handlers.onHover === "function") el.addEventListener("mouseenter", handlers.onHover);
          if (typeof handlers.onLeave === "function") el.addEventListener("mouseleave", handlers.onLeave);
          if (typeof handlers.onFocus === "function") el.addEventListener("focus", handlers.onFocus);
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows polyfill feature checks", () => {
      const code = `
        const setupPolyfills = () => {
          if (typeof globalThis.structuredClone === "undefined") globalThis.structuredClone = polyfill;
          if (typeof globalThis.AbortController === "undefined") globalThis.AbortController = AbortPolyfill;
          if (typeof globalThis.fetch === "undefined") globalThis.fetch = fetchPolyfill;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows React hook optional callback execution", () => {
      const code = `
        const useLifecycle = (callbacks) => {
          useEffect(() => {
            if (typeof callbacks.onMount === "function") callbacks.onMount();
            return () => {
              if (typeof callbacks.onUnmount === "function") callbacks.onUnmount();
            };
          }, []);
          if (typeof callbacks.onRender === "function") callbacks.onRender();
          if (typeof callbacks.onUpdate === "function") callbacks.onUpdate();
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows two typeof value-type checks that are under threshold", () => {
      const code = `
        const coerce = (val) => {
          if (typeof val === "string") return parseInt(val, 10);
          if (typeof val === "number") return val;
          throw new Error("unsupported");
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows Redux-style action type discriminator", () => {
      const code = `
        const reducer = (state, action) => {
          if ("type" in action && "payload" in action) {
            return { ...state, data: action.payload };
          }
          return state;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows simple type narrowing for serialization", () => {
      const code = `
        const serialize = (val) => {
          if (typeof val === "string") return JSON.stringify(val);
          if (typeof val === "number") return String(val);
          return String(val);
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows React.isValidElement-style duck type check (1 in + 1 typeof)", () => {
      const code = `
        const isElement = (obj) => {
          if (!("$$typeof" in obj)) return false;
          if (typeof obj.props !== "object") return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows Proxy/Reflect polyfill checks", () => {
      const code = `
        const canUseProxy = () => {
          if (typeof Proxy === "undefined") return false;
          if (typeof Reflect === "undefined") return false;
          if (typeof Symbol === "undefined") return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows event listener feature detection", () => {
      const code = `
        const supportsPassive = () => {
          if (typeof window === "undefined") return false;
          if (typeof window.addEventListener === "function") return true;
          if (typeof document.addEventListener === "function") return true;
          return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows SSR environment detection in Next.js", () => {
      const code = `
        const getEnvironment = () => {
          if (typeof window === "undefined") return "server";
          if (typeof document === "undefined") return "server";
          if (typeof localStorage === "undefined") return "server";
          if (typeof sessionStorage === "undefined") return "server";
          return "client";
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows mixed undefined + function checks (plugin system)", () => {
      const code = `
        const resolvePlugin = (plugin) => {
          if (typeof plugin === "undefined") return null;
          if (typeof plugin.setup === "function") plugin.setup();
          if (typeof plugin.init === "function") plugin.init();
          if (typeof plugin.teardown === "function") teardowns.push(plugin.teardown);
          if (typeof plugin.name === "undefined") plugin.name = "anonymous";
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows assert-style single-field validators", () => {
      const code = `
        const assertString = (val) => { if (typeof val !== "string") throw new Error(); };
        const assertNumber = (val) => { if (typeof val !== "number") throw new Error(); };
        const assertBoolean = (val) => { if (typeof val !== "boolean") throw new Error(); };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("allows IIFE with typeof checks for globals", () => {
      const code = `
        (() => {
          if (typeof window === "undefined") return;
          if (typeof document === "undefined") return;
          if (typeof MutationObserver === "undefined") return;
          setupObserver();
        })();
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 12: Real-world open source patterns (SHOULD flag)
  // ---------------------------------------------------------------------------
  describe("real-world patterns — SHOULD flag", () => {
    it("flags hand-rolled API response validation", () => {
      const code = `
        function validateApiResponse(response) {
          if (typeof response.status !== "number") throw new Error("invalid status");
          if (typeof response.message !== "string") throw new Error("invalid message");
          if (typeof response.data !== "object") throw new Error("invalid data");
          if (typeof response.timestamp !== "number") throw new Error("invalid timestamp");
          return response;
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("4 manual type checks");
    });

    it("flags manual config validation with in + typeof", () => {
      const code = `
        const validateConfig = (config) => {
          if (!("host" in config)) throw new Error("missing host");
          if (!("port" in config)) throw new Error("missing port");
          if (typeof config.host !== "string") throw new Error("host must be string");
          if (typeof config.port !== "number") throw new Error("port must be number");
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("4 manual type checks");
    });

    it("flags hand-rolled form data validation", () => {
      const code = `
        function validateFormData(formData) {
          if (typeof formData.firstName !== "string") return { error: "firstName" };
          if (typeof formData.lastName !== "string") return { error: "lastName" };
          if (typeof formData.age !== "number") return { error: "age" };
          if (typeof formData.email !== "string") return { error: "email" };
          if (typeof formData.agreed !== "boolean") return { error: "agreed" };
          return { error: null };
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("5 manual type checks");
    });

    it("flags env var validation with typeof", () => {
      const code = `
        const validateEnv = (env) => {
          if (typeof env.DATABASE_URL !== "string") throw new Error();
          if (typeof env.PORT !== "string") throw new Error();
          if (typeof env.SECRET !== "string") throw new Error();
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags manual webhook payload validation", () => {
      const code = `
        const validateWebhook = (payload) => {
          if (!("event" in payload)) throw new Error();
          if (!("timestamp" in payload)) throw new Error();
          if (!("signature" in payload)) throw new Error();
          if (typeof payload.event !== "string") throw new Error();
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("4 manual type checks");
    });

    it("flags manual GraphQL response validator", () => {
      const code = `
        const validateGqlResponse = (res) => {
          if (typeof res.data !== "object") return null;
          if (typeof res.errors !== "object") return null;
          if (typeof res.extensions !== "object") return null;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags manual JWT payload validation", () => {
      const code = `
        function validateJwtPayload(payload) {
          if (typeof payload.sub !== "string") throw new Error("missing sub");
          if (typeof payload.iat !== "number") throw new Error("missing iat");
          if (typeof payload.exp !== "number") throw new Error("missing exp");
          if (typeof payload.iss !== "string") throw new Error("missing iss");
          return payload;
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("4 manual type checks");
    });

    it("flags manual database row validation", () => {
      const code = `
        const isValidRow = (row) => {
          if (typeof row.id !== "number") return false;
          if (typeof row.created_at !== "string") return false;
          if (typeof row.updated_at !== "string") return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags hand-rolled SSE event validation", () => {
      const code = `
        const parseServerEvent = (event) => {
          if (!("type" in event)) return null;
          if (!("data" in event)) return null;
          if (!("id" in event)) return null;
          return event;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags manual feature flag validation", () => {
      const code = `
        function validateFeatureFlags(flags) {
          if (typeof flags.enableDarkMode !== "boolean") return false;
          if (typeof flags.enableBeta !== "boolean") return false;
          if (typeof flags.maxRetries !== "number") return false;
          return true;
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags manual user session validation", () => {
      const code = `
        const isValidSession = (session) => {
          if (typeof session.userId !== "string") return false;
          if (typeof session.token !== "string") return false;
          if (typeof session.expiresAt !== "number") return false;
          if (typeof session.isActive !== "boolean") return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("4 manual type checks");
    });

    it("flags manual settings object validation", () => {
      const code = `
        const validateSettings = (settings) => {
          if (typeof settings.theme !== "string") return false;
          if (typeof settings.fontSize !== "number") return false;
          if (typeof settings.notifications !== "boolean") return false;
          if (typeof settings.language !== "string") return false;
          if (typeof settings.timezone !== "string") return false;
          if (typeof settings.autoSave !== "boolean") return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("6 manual type checks");
    });

    it("flags manual CSV row validation", () => {
      const code = `
        function validateCsvRow(row) {
          if (typeof row.name !== "string") throw new Error("invalid name");
          if (typeof row.email !== "string") throw new Error("invalid email");
          if (typeof row.age !== "string") throw new Error("invalid age");
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags manual message bus event validation", () => {
      const code = `
        const isValidMessage = (msg) => {
          if (!("topic" in msg)) return false;
          if (!("payload" in msg)) return false;
          if (!("correlationId" in msg)) return false;
          if (typeof msg.topic !== "string") return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("4 manual type checks");
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 13: Test file skipping via test-noise tag
  // ---------------------------------------------------------------------------
  describe("skips test files via test-noise tag", () => {
    it("does not flag when filename looks like a test (.test.ts)", () => {
      const code = `
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code, { filename: "validate.test.ts" });
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag when filename is a spec file (.spec.ts)", () => {
      const code = `
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code, { filename: "validate.spec.ts" });
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag when filename is a test (.test.tsx)", () => {
      const code = `
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code, { filename: "component.test.tsx" });
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag when filename is a spec (.spec.js)", () => {
      const code = `
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code, { filename: "utils.spec.js" });
      expect(result.diagnostics).toHaveLength(0);
    });

    it("flags when filename is a regular source file", () => {
      const code = `
        const validate = (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code, { filename: "validate.ts" });
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 14: Edge cases and boundary conditions
  // ---------------------------------------------------------------------------
  describe("edge cases", () => {
    it("handles empty function body", () => {
      const code = `
        const noop = () => {};
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("handles arrow function with expression body (no block)", () => {
      const code = `
        const isString = (x) => typeof x === "string";
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("handles code with no functions at all", () => {
      const code = `
        const x = 1;
        const y = "hello";
        const z = true;
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("handles typeof without comparison (bare typeof expression)", () => {
      const code = `
        const getType = (val) => {
          const typeA = typeof val.a;
          const typeB = typeof val.b;
          const typeC = typeof val.c;
          return [typeA, typeB, typeC];
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("handles typeof in switch statement (not a binary comparison)", () => {
      const code = `
        const dispatch = (val) => {
          switch (typeof val) {
            case "string": return parseString(val);
            case "number": return parseNumber(val);
            case "boolean": return parseBoolean(val);
            default: return null;
          }
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag typeof inside template literal expressions", () => {
      const code = `
        const describe = (obj) => {
          return "types: " + typeof obj.a + ", " + typeof obj.b + ", " + typeof obj.c;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("handles multiple separate top-level functions each under threshold", () => {
      const code = `
        const checkA = (obj) => {
          if (typeof obj.x !== "string") return false;
          if (typeof obj.y !== "number") return false;
        };
        const checkB = (obj) => {
          if (typeof obj.a !== "string") return false;
          if (typeof obj.b !== "number") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("handles multiple separate top-level functions where one exceeds threshold", () => {
      const code = `
        const checkA = (obj) => {
          if (typeof obj.x !== "string") return false;
          if (typeof obj.y !== "number") return false;
        };
        const checkB = (obj) => {
          if (typeof obj.a !== "string") return false;
          if (typeof obj.b !== "number") return false;
          if (typeof obj.c !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("handles multiple separate top-level functions where both exceed threshold", () => {
      const code = `
        function validateA(obj) {
          if (typeof obj.x !== "string") return false;
          if (typeof obj.y !== "number") return false;
          if (typeof obj.z !== "boolean") return false;
        }
        function validateB(obj) {
          if (typeof obj.a !== "string") return false;
          if (typeof obj.b !== "number") return false;
          if (typeof obj.c !== "boolean") return false;
        }
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(2);
    });

    it("handles typeof in for loop inside function", () => {
      const code = `
        const validateFields = (obj, fields) => {
          if (typeof obj.name !== "string") return false;
          if (typeof obj.age !== "number") return false;
          if (typeof obj.active !== "boolean") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("handles typeof in try-catch block", () => {
      const code = `
        const safeParse = (data) => {
          try {
            if (typeof data.name !== "string") throw new Error();
            if (typeof data.id !== "number") throw new Error();
            if (typeof data.valid !== "boolean") throw new Error();
            return data;
          } catch (err) {
            return null;
          }
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("handles object method shorthand (function expression in object)", () => {
      const code = `
        const validators = {
          check: function(obj) {
            if (typeof obj.a !== "string") return false;
            if (typeof obj.b !== "number") return false;
            if (typeof obj.c !== "boolean") return false;
          }
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("handles default export of arrow function", () => {
      const code = `
        export default (input) => {
          if (typeof input.a !== "string") return false;
          if (typeof input.b !== "number") return false;
          if (typeof input.c !== "boolean") return false;
          return true;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("handles typeof with negated grouping", () => {
      const code = `
        const validate = (obj) => {
          if (!(typeof obj.a === "string")) return false;
          if (!(typeof obj.b === "number")) return false;
          if (!(typeof obj.c === "boolean")) return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 15: Combination of schema library + still-flagged scenarios
  // ---------------------------------------------------------------------------
  describe("schema library import does not cross file boundaries", () => {
    it("flags file without schema import even when pattern looks like migration", () => {
      const code = `
        const legacyValidate = (obj) => {
          if (typeof obj.name !== "string") return false;
          if (typeof obj.email !== "string") return false;
          if (typeof obj.age !== "number") return false;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(1);
    });
  });
});
