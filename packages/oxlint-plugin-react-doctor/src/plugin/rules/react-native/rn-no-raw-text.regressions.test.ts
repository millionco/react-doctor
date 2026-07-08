import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoRawText } from "./rn-no-raw-text.js";

const expectFail = (code: string): void => {
  const result = runRule(rnNoRawText, code, { filename: "App.native.tsx" });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(rnNoRawText, code, { filename: "App.native.tsx" });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

// Real-world FP source: web UIs living inside React-Native-aware packages
// (a DevTools panel built with react-dom + Tailwind next to the RN runtime
// it inspects, react-native-web trees, shared monorepo components). DOM
// tags don't exist on React Native — the element itself would fail before
// its raw text could — so raw text inside a known HTML/SVG tag is web
// markup, never the RN raw-text crash.
describe("react-native/rn-no-raw-text — regressions: DOM intrinsics are web markup", () => {
  it("stays silent on raw text inside a <span> with utility classes (DevTools web UI shape)", () => {
    expectPass(`
      export const CookieCard = ({ cookie }) => (
        <div className="bg-gray-800 rounded p-3">
          <span className="font-medium">Domain:</span> {cookie.domain}
        </div>
      );
    `);
  });

  it("stays silent on raw text inside a <div>", () => {
    expectPass(`const Empty = () => <div>No response body</div>;`);
  });

  it("stays silent on raw text inside a <button>", () => {
    expectPass(`const Close = ({ onClose }) => <button onClick={onClose}>Close</button>;`);
  });

  it("stays silent on an HTML entity inside a <span>", () => {
    expectPass(`const Dot = () => <span>&middot;</span>;`);
  });

  it("stays silent on a string-literal expression child of an <h4>", () => {
    expectPass(`const Heading = () => <h4>{"Message Details"}</h4>;`);
  });

  it("stays silent on raw text inside an svg <text> element", () => {
    expectPass(`
      const Chart = () => (
        <svg viewBox="0 0 100 100">
          <text x="10" y="20">42%</text>
        </svg>
      );
    `);
  });

  it("stays silent on an in-file badge component that forwards children into a <span>", () => {
    expectPass(`
      const Badge = ({ children, className }) => <span className={className}>{children}</span>;
      export const CookieFlags = () => <Badge className="text-yellow-400">Secure</Badge>;
    `);
  });

  it("still fires on raw text inside a React Native host primitive", () => {
    expectFail(`const Screen = () => <View>Hello</View>;`);
  });

  it("still fires on an in-file wrapper that forwards children into a View", () => {
    expectFail(`
      const Box = ({ children }) => <View>{children}</View>;
      const Screen = () => <Box>Hello</Box>;
    `);
  });

  it("still fires on a lowercase name that is not a known HTML/SVG tag", () => {
    expectFail(`
      const Screen = () => (
        <View>
          <fbt desc="greeting">Hello</fbt>
        </View>
      );
    `);
  });
});
