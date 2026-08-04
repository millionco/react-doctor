import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./state-and-effects/no-loading-flag-reset-outside-finally.js";
import { noEffectChain } from "./state-and-effects/no-effect-chain.js";
import { noUnstableNestedComponents } from "./react-builtins/no-unstable-nested-components.js";
import { rerenderStateOnlyInHandlers } from "./state-and-effects/rerender-state-only-in-handlers.js";
import { rnNoRawText } from "./react-native/rn-no-raw-text.js";

const COMPONENT_COUNT = 300;
const TEXT_WRAPPER_COUNT = 150;

const componentSource = Array.from(
  { length: COMPONENT_COUNT },
  (_, componentIndex) => `
    export const Component${componentIndex} = ({ seed }) => {
      const [value, setValue] = useState(seed);
      useEffect(() => subscribe(seed), [seed]);
      return <button onClick={() => setValue(seed + 1)}>{value}</button>;
    };
  `,
).join("\n");

const textWrapperSource = Array.from({ length: TEXT_WRAPPER_COUNT }, (_, offset) => {
  const wrapperIndex = TEXT_WRAPPER_COUNT - offset - 1;
  const elementName = wrapperIndex === 0 ? "Text" : `Wrapper${wrapperIndex - 1}`;
  return `const Wrapper${wrapperIndex} = ({ children }) => <${elementName}>{children}</${elementName}>;`;
}).join("\n");

describe("heavy rule performance", () => {
  for (const performanceCase of [
    { ruleName: "nested components", rule: noUnstableNestedComponents },
    { ruleName: "effect chains", rule: noEffectChain },
    { ruleName: "loading resets", rule: noLoadingFlagResetOutsideFinally },
    { ruleName: "handler-only state", rule: rerenderStateOnlyInHandlers },
  ]) {
    it(`handles many ordinary components for ${performanceCase.ruleName}`, () => {
      const result = runRule(
        performanceCase.rule,
        `import { useEffect, useState } from "react"; ${componentSource}`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  }

  it("classifies a long reverse-ordered text-wrapper chain", () => {
    const result = runRule(
      rnNoRawText,
      `import { Text } from "react-native"; ${textWrapperSource} const Screen = () => <Wrapper${TEXT_WRAPPER_COUNT - 1}>Hello</Wrapper${TEXT_WRAPPER_COUNT - 1}>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
