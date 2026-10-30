import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  NON_REACT_UTILITY_WORK_SMALL_CALL_COUNT,
  NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT,
} from "../../constants/thresholds.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const runTsx = (source: string) =>
  runRule(wrapWithSemanticContext(rulesOfHooks), source, { filename: "fixture.tsx" });

describe("Firebase immutable runtime API binding", () => {
  it.each([
    'interface useDeviceLanguage {}\nimport {useDeviceLanguage} from "firebase/auth";\nexport const configure=async auth=>{useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth";\ninterface useDeviceLanguage {}\nexport const configure=async auth=>{useDeviceLanguage(auth)};',
    'type useDeviceLanguage=unknown;\nimport {useDeviceLanguage} from "firebase/auth";\nexport const configure=async auth=>{useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth";\ntype useDeviceLanguage=unknown;\nexport const configure=async auth=>{useDeviceLanguage(auth)};',
    'interface useLanguage {}\nimport {useDeviceLanguage as useLanguage} from "firebase/auth";\nexport const configure=async auth=>{useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth";\ninterface useLanguage {}\nexport const configure=async auth=>{useLanguage(auth)};',
    'type useLanguage=unknown;\nimport {useDeviceLanguage as useLanguage} from "firebase/auth";\nexport const configure=async auth=>{useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth";\ntype useLanguage=unknown;\nexport const configure=async auth=>{useLanguage(auth)};',
  ])("preserves erased names around runtime imports: %s", (source) => {
    const result = runTsx(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it.each([
    'import {useDeviceLanguage} from "firebase/auth"; export const configure=async auth=>{const useDeviceLanguage=other;interface useDeviceLanguage {}useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth"; export const configure=async auth=>{let useDeviceLanguage=other;interface useDeviceLanguage {}useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth"; export const configure=async auth=>{declare const useDeviceLanguage:()=>void;interface useDeviceLanguage {}useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth"; export const configure=async auth=>{declare function useDeviceLanguage():void;interface useDeviceLanguage {}useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth";\nuseDeviceLanguage=replacement;interface useDeviceLanguage {} export const configure=async auth=>{useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth";\ninterface useDeviceLanguage {}useDeviceLanguage=replacement; export const configure=async auth=>{useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth"; export const configure=async auth=>{const useDeviceLanguage=other;type useDeviceLanguage=unknown;useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth"; export const configure=async auth=>{let useDeviceLanguage=other;type useDeviceLanguage=unknown;useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth"; export const configure=async auth=>{declare const useDeviceLanguage:()=>void;type useDeviceLanguage=unknown;useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth"; export const configure=async auth=>{declare function useDeviceLanguage():void;type useDeviceLanguage=unknown;useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth";\nuseDeviceLanguage=replacement;type useDeviceLanguage=unknown; export const configure=async auth=>{useDeviceLanguage(auth)};',
    'import {useDeviceLanguage} from "firebase/auth";\ntype useDeviceLanguage=unknown;useDeviceLanguage=replacement; export const configure=async auth=>{useDeviceLanguage(auth)};',
    'import {useIdentity as useDeviceLanguage} from "firebase/auth";interface useDeviceLanguage{}export const configure=async auth=>{useDeviceLanguage(auth)};',
    'import {useDeviceLanguage as useDeviceLanguage} from "firebase/auth/compat";interface useDeviceLanguage{}export const configure=async auth=>{useDeviceLanguage(auth)};',
    'import {usePlyrLayoutClasses as useDeviceLanguage} from "firebase/auth";interface useDeviceLanguage{}export const configure=async auth=>{useDeviceLanguage(auth)};',
    'import {useDeviceLanguage as useDeviceLanguage} from "vidstack";interface useDeviceLanguage{}export const configure=async auth=>{useDeviceLanguage(auth)};',
    'import type {useDeviceLanguage as useDeviceLanguage} from "firebase/auth";interface useDeviceLanguage{}export const configure=async auth=>{useDeviceLanguage(auth)};',
    'import {type useDeviceLanguage as useDeviceLanguage} from "firebase/auth";interface useDeviceLanguage{}export const configure=async auth=>{useDeviceLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth"; export const configure=async auth=>{const useLanguage=other;interface useLanguage {}useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth"; export const configure=async auth=>{let useLanguage=other;interface useLanguage {}useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth"; export const configure=async auth=>{declare const useLanguage:()=>void;interface useLanguage {}useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth"; export const configure=async auth=>{declare function useLanguage():void;interface useLanguage {}useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth";\nuseLanguage=replacement;interface useLanguage {} export const configure=async auth=>{useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth";\ninterface useLanguage {}useLanguage=replacement; export const configure=async auth=>{useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth"; export const configure=async auth=>{const useLanguage=other;type useLanguage=unknown;useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth"; export const configure=async auth=>{let useLanguage=other;type useLanguage=unknown;useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth"; export const configure=async auth=>{declare const useLanguage:()=>void;type useLanguage=unknown;useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth"; export const configure=async auth=>{declare function useLanguage():void;type useLanguage=unknown;useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth";\nuseLanguage=replacement;type useLanguage=unknown; export const configure=async auth=>{useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth";\ntype useLanguage=unknown;useLanguage=replacement; export const configure=async auth=>{useLanguage(auth)};',
    'import {useIdentity as useLanguage} from "firebase/auth";interface useLanguage{}export const configure=async auth=>{useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "firebase/auth/compat";interface useLanguage{}export const configure=async auth=>{useLanguage(auth)};',
    'import {usePlyrLayoutClasses as useLanguage} from "firebase/auth";interface useLanguage{}export const configure=async auth=>{useLanguage(auth)};',
    'import {useDeviceLanguage as useLanguage} from "vidstack";interface useLanguage{}export const configure=async auth=>{useLanguage(auth)};',
    'import type {useDeviceLanguage as useLanguage} from "firebase/auth";interface useLanguage{}export const configure=async auth=>{useLanguage(auth)};',
    'import {type useDeviceLanguage as useLanguage} from "firebase/auth";interface useLanguage{}export const configure=async auth=>{useLanguage(auth)};',
  ])("declines runtime shadows, erased imports, wrong roles and writes: %s", (source) => {
    const result = runTsx(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([NON_REACT_UTILITY_WORK_SMALL_CALL_COUNT, NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT])(
    "checks imported symbol references once for %s calls",
    (callCount) => {
      for (const mutation of ["", "useDeviceLanguage=replacement;"]) {
        let flagReads = 0;
        let referenceCount = 0;
        const observed: typeof rulesOfHooks = {
          ...rulesOfHooks,
          create: (context) => {
            const symbol = context.scopes.rootScope.symbols.find(
              (candidate) => candidate.name === "useDeviceLanguage",
            );
            if (!symbol) throw new Error("Expected imported API binding");
            referenceCount = symbol.references.length;
            for (const reference of symbol.references) {
              const flag = reference.flag;
              Object.defineProperty(reference, "flag", {
                configurable: true,
                get: () => {
                  flagReads += 1;
                  return flag;
                },
              });
            }
            return rulesOfHooks.create(context);
          },
        };
        const source = `import {useDeviceLanguage} from "firebase/auth";export const configure=async auth=>{${Array.from({ length: callCount }, () => "useDeviceLanguage(auth);").join("")}};${mutation}`;
        const result = runRule(wrapWithSemanticContext(observed), source, {
          filename: "fixture.tsx",
        });
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(mutation ? callCount : 0);
        expect(flagReads).toBeGreaterThan(0);
        expect(flagReads).toBeLessThanOrEqual(referenceCount);
        if (mutation) expect(flagReads).toBeLessThan(callCount);
      }
    },
  );
  it("keeps distinct analyses independent", () => {
    for (const mutation of ["", "useDeviceLanguage=replacement;", ""]) {
      const result = runTsx(
        `import {useDeviceLanguage} from "firebase/auth";${mutation}export const configure=async auth=>{useDeviceLanguage(auth)};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(mutation ? 1 : 0);
    }
  });
});
