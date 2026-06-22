import { describe, expect, it } from "vitest";
import { detectForeignDisableNearMiss } from "../../src/detect-foreign-disable-near-miss.js";

describe("regression: issue #920 - Object.prototype key collision in disable comments", () => {
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
    it(`does not crash when eslint-disable-next-line contains ${prototypeKey}`, () => {
      const lines = [`// eslint-disable-next-line ${prototypeKey}`, "<img />"];
      expect(() => detectForeignDisableNearMiss(lines, 1, "react-doctor/alt-text")).not.toThrow();
    });

    it(`does not crash when oxlint-disable block contains ${prototypeKey}`, () => {
      const lines = [`/* oxlint-disable ${prototypeKey} */`, "const a = 1;", "<img />"];
      expect(() => detectForeignDisableNearMiss(lines, 2, "react-doctor/alt-text")).not.toThrow();
    });

    it(`does not crash when eslint-disable-line contains ${prototypeKey}`, () => {
      const lines = [`<img /> // eslint-disable-line ${prototypeKey}`];
      expect(() => detectForeignDisableNearMiss(lines, 0, "react-doctor/alt-text")).not.toThrow();
    });
  });

  it("correctly identifies no near-miss when Object.prototype key is in disable list", () => {
    const lines = ["// eslint-disable-next-line constructor", "<img />"];
    const result = detectForeignDisableNearMiss(lines, 1, "react-doctor/alt-text");
    expect(result).toBeNull();
  });

  it("still detects near-misses for bare short ids alongside Object.prototype keys", () => {
    const lines = ["// eslint-disable-next-line constructor, alt-text", "<img />"];
    const result = detectForeignDisableNearMiss(lines, 1, "react-doctor/alt-text");
    expect(result).toContain("react-doctor/alt-text");
    expect(result).toContain("alt-text");
  });
});
