import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoRawText } from "./rn-no-raw-text.js";

describe("rn-no-raw-text", () => {
  it("flags raw text directly inside a View", () => {
    const code = `const App = () => <View>Hello</View>;`;
    const result = runRule(rnNoRawText, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("outside a <Text>");
  });

  it("does NOT flag raw text inside Text", () => {
    const code = `const App = () => <Text>Hello</Text>;`;
    const result = runRule(rnNoRawText, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag raw text inside same-file Text wrapper components", () => {
    const code = `
      const Copy = ({ children }) => <Text>{children}</Text>;
      const App = () => <View><Copy>Hello</Copy></View>;
    `;
    const result = runRule(rnNoRawText, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag raw text inside memoized Text wrapper components", () => {
    const code = `
      const Copy = React.memo(({ children }) => <Text>{children}</Text>);
      const App = () => <View><Copy>Hello</Copy></View>;
    `;
    const result = runRule(rnNoRawText, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag raw text inside forwardRef Text wrapper components", () => {
    const code = `
      const Copy = forwardRef(({ children }, ref) => <Text ref={ref}>{children}</Text>);
      const App = () => <View><Copy>Hello</Copy></View>;
    `;
    const result = runRule(rnNoRawText, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag raw text inside components that compose local Text wrappers", () => {
    const code = `
      const Copy = ({ children }) => <Text>{children}</Text>;
      const Emphasis = ({ children }) => <Copy>{children}</Copy>;
      const App = () => <View><Emphasis>Hello</Emphasis></View>;
    `;
    const result = runRule(rnNoRawText, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag raw text inside function declaration Text wrappers", () => {
    const code = `
      function Copy({ children }) {
        return <Text>{children}</Text>;
      }
      const App = () => <View><Copy>Hello</Copy></View>;
    `;
    const result = runRule(rnNoRawText, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag raw text inside conditional Text wrappers", () => {
    const code = `
      const Copy = ({ children, hidden }) => hidden ? null : <Text>{children}</Text>;
      const App = () => <View><Copy>Hello</Copy></View>;
    `;
    const result = runRule(rnNoRawText, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag raw text inside logical Text wrappers", () => {
    const code = `
      const Copy = ({ children, visible }) => visible && <Text>{children}</Text>;
      const App = () => <View><Copy>Hello</Copy></View>;
    `;
    const result = runRule(rnNoRawText, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags raw text inside same-file non-Text wrapper components", () => {
    const code = `
      const Card = ({ children }) => <View>{children}</View>;
      const App = () => <Card>Hello</Card>;
    `;
    const result = runRule(rnNoRawText, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags raw text inside unknown custom components", () => {
    const code = `const App = () => <Card>Hello</Card>;`;
    const result = runRule(rnNoRawText, code);
    expect(result.diagnostics).toHaveLength(1);
  });
});
