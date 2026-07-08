import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingConditionalRender } from "./rendering-conditional-render.js";

const expectFail = (code: string): void => {
  const result = runRule(renderingConditionalRender, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(renderingConditionalRender, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("correctness/rendering-conditional-render — regressions", () => {
  it("still flags a `.length` guard", () => {
    expectFail(`const C = ({ items }) => <div>{items.length && <List items={items} />}</div>;`);
  });

  it("still flags a numeric-suffixed identifier", () => {
    expectFail(`const C = ({ userCount }) => <div>{userCount && <Badge n={userCount} />}</div>;`);
  });

  it("still flags an upper-snake numeric identifier", () => {
    expectFail(`const C = () => <div>{USER_COUNT && <Badge n={USER_COUNT} />}</div>;`);
  });

  // FP anchor (audius ProfileInfoTiles `showCount`, devlovers CartButton
  // `const showCount = itemCount > 0`): a boolean-verb prefix marks the
  // identifier as a flag about the number, not the number itself — a
  // boolean can never render a stray '0'.
  it("does not flag a show-prefixed boolean flag", () => {
    expectPass(
      `const C = ({ showCount, count }) => <div>{showCount && <Text>{count}</Text>}</div>;`,
    );
  });

  // FP anchor (mezzanine UploadItem `shouldShowFileSize`).
  it("does not flag a should-prefixed boolean flag", () => {
    expectPass(
      `const C = ({ shouldShowFileSize, fileSize }) => <div>{shouldShowFileSize && <span>{fileSize}</span>}</div>;`,
    );
  });

  // FP anchor (ant-design-mobile text-area `autoSize`, typed
  // boolean | { minRows; maxRows }).
  it("does not flag an auto-prefixed boolean flag", () => {
    expectPass(`const C = ({ autoSize }) => <div>{autoSize && <textarea rows={2} />}</div>;`);
  });
});
