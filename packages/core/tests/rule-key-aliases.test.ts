import { describe, it, expect } from "vitest";
import {
  isSameRuleKey,
  getEquivalentRuleKeys,
  REACT_DOCTOR_RULE_KEY_PREFIX,
} from "../src/rule-key-aliases.js";

describe("rule-key-aliases", () => {
  describe("isSameRuleKey", () => {
    it("matches identical keys", () => {
      expect(isSameRuleKey("react-doctor/jsx-key", "react-doctor/jsx-key")).toBe(true);
    });

    it("matches legacy alias to native key", () => {
      expect(isSameRuleKey("react/jsx-key", "react-doctor/jsx-key")).toBe(true);
      expect(isSameRuleKey("jsx-a11y/alt-text", "react-doctor/alt-text")).toBe(true);
      expect(isSameRuleKey("react-hooks/exhaustive-deps", "react-doctor/exhaustive-deps")).toBe(
        true,
      );
    });

    it("matches native key to legacy alias", () => {
      expect(isSameRuleKey("react-doctor/jsx-key", "react/jsx-key")).toBe(true);
      expect(isSameRuleKey("react-doctor/alt-text", "jsx-a11y/alt-text")).toBe(true);
    });

    it("matches short id to qualified key", () => {
      expect(isSameRuleKey("jsx-key", "react-doctor/jsx-key")).toBe(true);
      expect(isSameRuleKey("alt-text", "react-doctor/alt-text")).toBe(true);
      expect(isSameRuleKey("no-eval", "react-doctor/no-eval")).toBe(true);
    });

    it("matches qualified key to short id", () => {
      expect(isSameRuleKey("react-doctor/jsx-key", "jsx-key")).toBe(true);
      expect(isSameRuleKey("react-doctor/alt-text", "alt-text")).toBe(true);
    });

    it("does not match different rules", () => {
      expect(isSameRuleKey("react-doctor/jsx-key", "react-doctor/alt-text")).toBe(false);
      expect(isSameRuleKey("react/jsx-key", "react/alt-text")).toBe(false);
      expect(isSameRuleKey("jsx-key", "alt-text")).toBe(false);
    });

    it("does not match qualified keys from different plugins", () => {
      expect(isSameRuleKey("eslint/no-eval", "react-doctor/no-eval")).toBe(false);
      expect(isSameRuleKey("other/jsx-key", "react-doctor/jsx-key")).toBe(false);
    });

    describe("Object.prototype key collision resistance (issue #920)", () => {
      const OBJECT_PROTOTYPE_KEYS = [
        "constructor",
        "toString",
        "valueOf",
        "hasOwnProperty",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "toLocaleString",
        "__proto__",
      ];

      OBJECT_PROTOTYPE_KEYS.forEach((prototypeKey) => {
        it(`does not crash when testing ${prototypeKey}`, () => {
          expect(() => isSameRuleKey(prototypeKey, "react-doctor/jsx-key")).not.toThrow();
        });

        it(`returns false for unrelated ${prototypeKey} vs react-doctor rule`, () => {
          expect(isSameRuleKey(prototypeKey, "react-doctor/jsx-key")).toBe(false);
        });

        it(`does not crash when ${prototypeKey} is the target key`, () => {
          expect(() => isSameRuleKey("react-doctor/jsx-key", prototypeKey)).not.toThrow();
        });

        it(`treats ${prototypeKey} as a potential short id, not an inherited method`, () => {
          const potentialRuleName = `${REACT_DOCTOR_RULE_KEY_PREFIX}${prototypeKey}`;
          expect(isSameRuleKey(prototypeKey, potentialRuleName)).toBe(true);
        });
      });

      it("does not crash with multiple prototype keys", () => {
        expect(() => isSameRuleKey("constructor", "toString")).not.toThrow();
        expect(() => isSameRuleKey("valueOf", "hasOwnProperty")).not.toThrow();
      });
    });
  });

  describe("getEquivalentRuleKeys", () => {
    it("returns native key and legacy aliases for a legacy key", () => {
      const keys = getEquivalentRuleKeys("react/jsx-key");
      expect(keys).toContain("react-doctor/jsx-key");
      expect(keys).toContain("react/jsx-key");
    });

    it("returns native key and legacy aliases for a native key", () => {
      const keys = getEquivalentRuleKeys("react-doctor/jsx-key");
      expect(keys).toContain("react-doctor/jsx-key");
      expect(keys).toContain("react/jsx-key");
    });

    it("returns only the key itself for unknown keys", () => {
      const keys = getEquivalentRuleKeys("some-unknown-rule");
      expect(keys).toEqual(["some-unknown-rule"]);
    });

    it("does not crash with Object.prototype keys", () => {
      expect(() => getEquivalentRuleKeys("constructor")).not.toThrow();
      expect(() => getEquivalentRuleKeys("toString")).not.toThrow();
      expect(() => getEquivalentRuleKeys("valueOf")).not.toThrow();
    });

    it("treats Object.prototype keys as unknown keys", () => {
      expect(getEquivalentRuleKeys("constructor")).toEqual(["constructor"]);
      expect(getEquivalentRuleKeys("toString")).toEqual(["toString"]);
    });
  });
});
