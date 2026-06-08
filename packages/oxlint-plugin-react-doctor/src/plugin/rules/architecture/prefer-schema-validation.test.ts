import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferSchemaValidation } from "./prefer-schema-validation.js";

describe("prefer-schema-validation", () => {
  describe("reports hand-rolled validation", () => {
    it("flags a TS type guard with several typeof member checks", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isUser(value: unknown): value is User {
          return (
            typeof value.id === "string" &&
            typeof value.name === "string" &&
            typeof value.age === "number"
          );
        }
      `,
        { filename: "is-user.ts" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("isUser");
      expect(result.diagnostics[0].message).toContain("value");
      expect(result.diagnostics[0].message).toContain("3 `typeof` checks");
      expect(result.diagnostics[0].message).toContain("schema validator");
    });

    it("flags an assertion function that throws on bad fields", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function assertConfig(input: unknown): asserts input is Config {
          if (typeof input.host !== "string") throw new Error("host");
          if (typeof input.port !== "number") throw new Error("port");
        }
      `,
        { filename: "assert-config.ts" },
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("assertConfig");
      expect(result.diagnostics[0].message).toContain("2 `typeof` checks");
    });

    it("flags an untyped validator-named arrow in plain JS", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        const isUser = (value) =>
          typeof value.id === "string" && typeof value.name === "string";
      `,
        { filename: "is-user.js" },
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("isUser");
    });

    it("flags a validate*-named function declaration", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function validateConfig(config) {
          return (
            typeof config.host === "string" &&
            typeof config.port === "number" &&
            typeof config.secure === "boolean"
          );
        }
      `,
        { filename: "validate-config.js" },
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("validateConfig");
    });

    it("flags an object method validator", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        const guards = {
          isPoint(value) {
            return typeof value.x === "number" && typeof value.y === "number";
          },
        };
      `,
        { filename: "guards.js" },
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("isPoint");
    });

    it("flags a class method validator", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        class Parser {
          validatePayload(payload) {
            return typeof payload.id === "string" && typeof payload.kind === "string";
          }
        }
      `,
        { filename: "parser.js" },
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("validatePayload");
    });

    it("flags a validator assigned to a member expression", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        const validators = {};
        validators.validateUser = (value) =>
          typeof value.id === "string" && typeof value.name === "string";
      `,
        { filename: "validators.js" },
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("validateUser");
    });

    it("resolves the param root through `as` casts and parentheses", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isUser(value: unknown): value is User {
          return (
            typeof (value as User).id === "string" &&
            typeof (value).name === "string"
          );
        }
      `,
        { filename: "is-user.ts" },
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("2 `typeof` checks");
    });

    it("resolves the param root through optional chaining", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isUser(value: unknown): value is User {
          return typeof value?.id === "string" && typeof value?.name === "string";
        }
      `,
        { filename: "is-user.ts" },
      );

      expect(result.diagnostics).toHaveLength(1);
    });

    it("counts static string-computed members and nested property paths distinctly", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isAddress(value) {
          return (
            typeof value["street"] === "string" &&
            typeof value.geo.lat === "number" &&
            typeof value.geo.lng === "number"
          );
        }
      `,
        { filename: "is-address.js" },
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("3 `typeof` checks");
    });

    it("flags the idiomatic object guard that also checks `typeof value`", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isUser(value: unknown): value is User {
          return (
            typeof value === "object" &&
            value !== null &&
            typeof value.id === "string" &&
            typeof value.name === "string"
          );
        }
      `,
        { filename: "is-user.ts" },
      );

      expect(result.diagnostics).toHaveLength(1);
      // The bare `typeof value` dispatch is not a member check, so only the
      // two member checks count.
      expect(result.diagnostics[0].message).toContain("2 `typeof` checks");
    });

    it("labels an anonymous type-guard arrow without a binding name", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        useGuard((value: unknown): value is User =>
          typeof value.id === "string" && typeof value.name === "string");
      `,
        { filename: "use-guard.ts" },
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("This type guard");
    });
  });

  describe("stays quiet on valid code", () => {
    it("does not flag a single typeof member check", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isCallable(options) {
          return typeof options.onChange === "function";
        }
      `,
        { filename: "is-callable.js" },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag polymorphic dispatch on the parameter itself", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function format(value) {
          if (typeof value === "string") return value;
          if (typeof value === "number") return String(value);
          if (typeof value === "boolean") return value ? "yes" : "no";
          return "";
        }
      `,
        { filename: "format.js" },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a non-validator function even with several member checks", () => {
      // No type predicate and no validator-like name: a serializer that
      // inspects runtime types is intentionally out of scope for v1.
      const result = runRule(
        preferSchemaValidation,
        `
        function serialize(node) {
          if (typeof node.value === "string") return node.value;
          if (typeof node.count === "number") return String(node.count);
          if (typeof node.flag === "boolean") return node.flag ? "1" : "0";
          return "";
        }
      `,
        { filename: "serialize.js" },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag typeof checks rooted at a different object", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isSupported(value) {
          return (
            typeof window.IntersectionObserver === "function" &&
            typeof navigator.serviceWorker === "object"
          );
        }
      `,
        { filename: "is-supported.js" },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not count typeof checks inside a nested function", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isReady(value) {
          const inner = (other) =>
            typeof other.a === "string" && typeof other.b === "string";
          return typeof value.loaded === "boolean" && inner(value.meta);
        }
      `,
        { filename: "is-ready.js" },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("dedupes repeated checks on the same property (optional-field guard)", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isName(value) {
          return typeof value.name === "string" || typeof value.name === "undefined";
        }
      `,
        { filename: "is-name.js" },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("ignores comparisons against non-typeof string literals", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isAdmin(user) {
          return typeof user.id === "string" && user.role === "admin";
        }
      `,
        { filename: "is-admin.js" },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not over-count dynamic computed members", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isShape(value, keyA, keyB) {
          return typeof value[keyA] === "string" && typeof value[keyB] === "number";
        }
      `,
        { filename: "is-shape.js" },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not match names that merely start with validator letters", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function island(value) {
          return typeof value.lat === "number" && typeof value.lng === "number";
        }
      `,
        { filename: "island.js" },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag destructured-parameter validators (v1 non-goal)", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function isUser({ id, name }) {
          return typeof id === "string" && typeof name === "string";
        }
      `,
        { filename: "is-user.js" },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a render-prop children check", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        function Panel({ children, title }) {
          if (typeof children === "function") return children(title);
          return children;
        }
      `,
        { filename: "panel.tsx" },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag code that already uses a schema validator", () => {
      const result = runRule(
        preferSchemaValidation,
        `
        import { z } from "zod";
        const userSchema = z.object({ id: z.string(), name: z.string() });
        const parseUser = (value) => userSchema.parse(value);
      `,
        { filename: "user-schema.ts" },
      );

      expect(result.diagnostics).toEqual([]);
    });
  });
});
