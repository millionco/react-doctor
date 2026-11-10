import { describe, expect, it, vi } from "vite-plus/test";
import {
  LARGE_LOGICAL_RECEIVER_ALIAS_COUNT,
  MAXIMUM_LOGICAL_RECEIVER_LOOKUP_GROWTH_MULTIPLIER,
  SMALL_LOGICAL_RECEIVER_ALIAS_COUNT,
} from "../../../test-utils/logical-receiver-proof/constants.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const measureAliasDagSymbolLookupCount = (aliasCount: number): number => {
  let symbolLookupCount = 0;
  let restoreSymbolFor = () => {};
  const observedRule: Rule = {
    ...effectNeedsCleanup,
    create: (context) => {
      const originalSymbolFor = context.scopes.symbolFor.bind(context.scopes);
      const symbolForSpy = vi
        .spyOn(context.scopes, "symbolFor")
        .mockImplementation((identifier) => {
          if (isNodeOfType(identifier, "Identifier") && identifier.name.startsWith("alias")) {
            symbolLookupCount += 1;
          }
          return originalSymbolFor(identifier);
        });
      restoreSymbolFor = () => symbolForSpy.mockRestore();
      return effectNeedsCleanup.create(context);
    },
  };
  const aliases = Array.from(
    { length: aliasCount },
    (_unusedValue, aliasIndex) =>
      `const alias${aliasIndex + 1} = alias${aliasIndex} || alias${aliasIndex};`,
  ).join("\n");
  const source = `import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
export const NavigationAliasDag = () => {
  const navigation = useNavigation();
  const alias0 = navigation;
  ${aliases}
  useEffect(() => {
    const unsubscribe = alias${aliasCount}.addListener("event", () => {});
    return () => unsubscribe();
  }, [alias${aliasCount}]);
  return null;
};`;
  try {
    const result = runRule(wrapWithSemanticContext(observedRule), source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(symbolLookupCount).toBeGreaterThan(0);
  } finally {
    restoreSymbolFor();
  }
  return symbolLookupCount;
};

describe("effect-needs-cleanup logical receiver proof work", () => {
  it("reuses successful readonly alias proofs across independent branches", () => {
    const smallCount = measureAliasDagSymbolLookupCount(SMALL_LOGICAL_RECEIVER_ALIAS_COUNT);
    const largeCount = measureAliasDagSymbolLookupCount(LARGE_LOGICAL_RECEIVER_ALIAS_COUNT);
    expect(largeCount).toBeLessThanOrEqual(
      smallCount * MAXIMUM_LOGICAL_RECEIVER_LOOKUP_GROWTH_MULTIPLIER,
    );
  });
});
