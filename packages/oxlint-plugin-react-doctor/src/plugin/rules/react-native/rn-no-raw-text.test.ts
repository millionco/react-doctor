import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoRawText } from "./rn-no-raw-text.js";

const expectFail = (code: string, settings?: Readonly<Record<string, unknown>>): void => {
  const result = runRule(rnNoRawText, code, { settings, filename: "App.native.tsx" });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string, settings?: Readonly<Record<string, unknown>>): void => {
  const result = runRule(rnNoRawText, code, { settings, filename: "App.native.tsx" });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("react-native/rn-no-raw-text", () => {
  it("fires on raw text with no Text ancestor", () => {
    expectFail(`const App = () => <View>Hello</View>;`);
  });

  it("does not fire inside a real Text component", () => {
    expectPass(`const App = () => <Text>Hello</Text>;`);
  });

  describe("auto-detected text wrappers", () => {
    it("suppresses string-only usage of an arrow forwarder", () => {
      expectPass(`
        const Banner = ({ children }) => <Text>{children}</Text>;
        const App = () => <Banner>Hello</Banner>;
      `);
    });

    it("suppresses a spread re-export wrapper", () => {
      expectPass(`
        export const Caption = (props) => <Text {...props} />;
        const App = () => <Caption>hi there</Caption>;
      `);
    });

    it("suppresses a function-declaration forwarder", () => {
      expectPass(`
        function Banner({ children }) { return <Text>{children}</Text>; }
        const App = () => <Banner>Hello</Banner>;
      `);
    });

    it("works regardless of declaration order (usage before definition)", () => {
      expectPass(`
        const App = () => <Banner>Hello</Banner>;
        const Banner = ({ children }) => <Text>{children}</Text>;
      `);
    });

    // The forwarder's `<Text>` root wraps WHATEVER children it receives, so
    // mixed children (`<Label><Icon/> text</Label>`) render that text inside
    // `<Text>` — no crash. Reporting it would be a false positive, so an
    // auto-detected forwarder is trusted like a real text container.
    it("does not fire on mixed children of an auto-detected forwarder", () => {
      expectPass(`
        const Label = ({ children }) => <Text>{children}</Text>;
        const App = () => <Label><Icon /> text</Label>;
      `);
    });

    it("does not treat a non-text forwarder as a wrapper", () => {
      expectFail(`
        const Box = ({ children }) => <View>{children}</View>;
        const App = () => <Box>Hello</Box>;
      `);
    });

    // An imported (cross-file) text-named component has no in-file definition,
    // so it's suppressed by the name heuristic instead — same safe result.
    it("suppresses an imported text-named component via the name heuristic", () => {
      expectPass(`
        import { Label } from "./ui";
        const App = () => <Label><Icon /> text</Label>;
      `);
    });
  });
});
