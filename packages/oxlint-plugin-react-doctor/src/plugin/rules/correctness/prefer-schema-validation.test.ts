import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferSchemaValidation } from "./prefer-schema-validation.js";

describe("prefer-schema-validation", () => {
  describe("flags manual typeof validation plumbing", () => {
    it("flags 3+ typeof checks in a function body", () => {
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

    it("flags many typeof checks in a regular function", () => {
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

    it("flags typeof checks with loose equality", () => {
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
  });

  describe("does not flag legitimate typeof usage (false positives)", () => {
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

    it("allows typeof checks in separate nested functions (scoping)", () => {
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

    it("allows a single in-expression check", () => {
      const code = `
        const hasData = (response) => {
          return "data" in response;
        };
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag code with no typeof / in / hasOwnProperty", () => {
      const code = `
        const sum = (arr) => arr.reduce((total, num) => total + num, 0);
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag typeof checks at module scope", () => {
      const code = `
        if (typeof window !== "undefined") console.log("browser");
        if (typeof process !== "undefined") console.log("node");
        if (typeof globalThis !== "undefined") console.log("universal");
      `;
      const result = runRule(preferSchemaValidation, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("real-world open source patterns (should not flag)", () => {
    it("allows React feature detection (typeof window)", () => {
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

    it("allows environment detection with typeof checks for globals", () => {
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
  });

  describe("real-world open source patterns (should flag)", () => {
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
  });

  describe("skips test files via test-noise tag", () => {
    it("does not flag when filename looks like a test", () => {
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

    it("does not flag when filename is a spec file", () => {
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
  });
});
