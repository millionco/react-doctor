import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsEarlyExit } from "./js-early-exit.js";

const expectFail = (code: string): void => {
  const result = runRule(jsEarlyExit, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsEarlyExit, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-early-exit — regressions", () => {
  it("flags a pure single-branch chain at depth 4", () => {
    expectFail(`function handle(a, b, c, d) {
      if (a) {
        if (b) {
          if (c) {
            if (d) {
              run();
            }
          }
        }
      }
    }`);
  });

  it("stays silent when nested forks carry else branches", () => {
    expectPass(`const onClickHandler = (menu) => {
      if (!menu.disabled) {
        if (menu.subMenu) {
          if (!expanded) {
            if (onClick) onClick(menu.subMenu[0]);
          } else {
            updateMenuState(menu);
          }
        } else {
          if (onClick) onClick(menu);
        }
      }
    };`);
  });

  it("stays silent on else-if chains inside the nest", () => {
    expectPass(`function styleChars(chars) {
      for (const ch of chars) {
        if (isOpen(ch)) {
          if (isBold(ch)) {
            markBold(ch);
          } else if (isItalic(ch)) {
            markItalic(ch);
          } else if (isCode(ch)) {
            markCode(ch);
          }
        }
      }
    }`);
  });

  it("stays silent when the top-level if itself has an else", () => {
    expectPass(`function release(shouldClose) {
      if (shouldClose) {
        if (!blockClose) {
          if (offset) {
            if (animate) close(offset);
          }
        }
      } else {
        snapBack();
      }
    }`);
  });
});
