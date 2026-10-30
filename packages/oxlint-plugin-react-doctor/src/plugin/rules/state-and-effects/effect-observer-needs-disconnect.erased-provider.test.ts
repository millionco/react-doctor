import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectObserverNeedsDisconnect } from "./effect-observer-needs-disconnect.js";

const cases = [
  {
    name: "preserves an inert erased declaration",
    code: 'declare const Object: any;import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after declare const Object: any;",
    code: 'declare const Object: any;import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {Object.defineProperty(Object.getPrototypeOf([]), "map", {value: () => []});}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after interface Object {}",
    code: 'interface Object {}import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {Object.defineProperty(Object.getPrototypeOf([]), "map", {value: () => []});}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: 'rejects runtime provider rewriting after import type Object from "provider-types";',
    code: 'import type Object from "provider-types";import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {Object.defineProperty(Object.getPrototypeOf([]), "map", {value: () => []});}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "rejects type-only import-equals provider rewrites",
    code: 'import type Object = require("provider-types");import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {Object.defineProperty(Object.getPrototypeOf([]), "map", {value: () => []});}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "preserves genuine import-equals value binding",
    code: 'import Object = require("provider-values");import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {Object.defineProperty(Object.getPrototypeOf([]), "map", {value: () => []});}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 0,
  },
  {
    name: "preserves genuine value binding with merged interface",
    code: 'const Object = {defineProperty: () => null, getPrototypeOf: () => ({})}; interface Object {}import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {Object.defineProperty(Object.getPrototypeOf([]), "map", {value: () => []});}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 0,
  },
  {
    name: "rejects empty namespace provider masking",
    code: 'namespace Object {}import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {Object.defineProperty(Object.getPrototypeOf([]), "map", {value: () => []});}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "rejects type-only namespace provider masking",
    code: 'namespace Object { export interface Marker {} }import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {Object.defineProperty(Object.getPrototypeOf([]), "map", {value: () => []});}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "rejects nested type-only namespace provider masking",
    code: 'namespace Object { export namespace Nested { export type Marker = unknown; } }import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {Object.defineProperty(Object.getPrototypeOf([]), "map", {value: () => []});}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "preserves an inert empty namespace",
    code: 'namespace Object {}import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 0,
  },
  {
    name: "preserves a genuine runtime namespace",
    code: 'namespace Object { export const marker = 1; } void Object;import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 0,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(effectObserverNeedsDisconnect, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
