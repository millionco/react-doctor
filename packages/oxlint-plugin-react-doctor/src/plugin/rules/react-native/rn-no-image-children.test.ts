import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoImageChildren } from "./rn-no-image-children.js";

describe("rn-no-image-children", () => {
  it("flags a react-native <Image> with a text child", () => {
    const code = `
      import { Image } from "react-native";
      const App = () => <Image source={src}>Caption</Image>;
    `;
    const result = runRule(rnNoImageChildren, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("ImageBackground");
  });

  it("flags a react-native <Image> with an element child", () => {
    const code = `
      import { Image, Text } from "react-native";
      const App = () => <Image source={src}><Text>Badge</Text></Image>;
    `;
    const result = runRule(rnNoImageChildren, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a react-native <Image> with a non-trivial expression child", () => {
    const code = `
      import { Image } from "react-native";
      const App = () => <Image source={src}>{badge}</Image>;
    `;
    const result = runRule(rnNoImageChildren, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an aliased react-native Image import", () => {
    const code = `
      import { Image as RNImage } from "react-native";
      const App = () => <RNImage source={src}><Overlay /></RNImage>;
    `;
    const result = runRule(rnNoImageChildren, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag a self-closing react-native <Image>", () => {
    const code = `
      import { Image } from "react-native";
      const App = () => <Image source={src} />;
    `;
    const result = runRule(rnNoImageChildren, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag whitespace-only children", () => {
    const code = `
      import { Image } from "react-native";
      const App = () => (
        <Image source={src}>
        </Image>
      );
    `;
    const result = runRule(rnNoImageChildren, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag {null} / {false} conditional-render children", () => {
    const code = `
      import { Image } from "react-native";
      const A = () => <Image source={src}>{null}</Image>;
      const B = () => <Image source={src}>{false}</Image>;
    `;
    const result = runRule(rnNoImageChildren, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag expo-image <Image> with children", () => {
    const code = `
      import { Image } from "expo-image";
      const App = () => <Image source={src}><Overlay /></Image>;
    `;
    const result = runRule(rnNoImageChildren, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a custom/local <Image> with children", () => {
    const code = `
      import { Image } from "../components/Image";
      const App = () => <Image source={src}><Overlay /></Image>;
    `;
    const result = runRule(rnNoImageChildren, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag <ImageBackground> with children", () => {
    const code = `
      import { ImageBackground, Text } from "react-native";
      const App = () => <ImageBackground source={src}><Text>hi</Text></ImageBackground>;
    `;
    const result = runRule(rnNoImageChildren, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
