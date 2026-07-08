import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnPreferExpoImage } from "./rn-prefer-expo-image.js";

const expoSettings = { "react-doctor": { framework: "expo" } } as const;

describe("react-native/rn-prefer-expo-image — regressions", () => {
  it("stays silent on a type-only declaration import", () => {
    const result = runRule(rnPreferExpoImage, `import type { Image } from "react-native";`, {
      filename: "App.tsx",
      settings: expoSettings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an inline type-only specifier", () => {
    const result = runRule(rnPreferExpoImage, `import { type Image } from "react-native";`, {
      filename: "App.tsx",
      settings: expoSettings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a value import of Image", () => {
    const result = runRule(rnPreferExpoImage, `import { Image } from "react-native";`, {
      filename: "App.tsx",
      settings: expoSettings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the only usage renders an imported bundled asset", () => {
    const result = runRule(
      rnPreferExpoImage,
      `import IconTokenNoTierPng from "@audius/harmony/src/assets/icons/TokenNoTier.png";
      import { Image } from "react-native";
      export const IconTokenNoTier = () => <Image source={IconTokenNoTierPng} />;`,
      { filename: "App.tsx", settings: expoSettings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the only usage renders an inline require of a bundled asset", () => {
    const result = runRule(
      rnPreferExpoImage,
      `import { Image } from "react-native";
      export const Logo = () => <Image source={require("../assets/logo.png")} />;`,
      { filename: "App.tsx", settings: expoSettings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the source resolves through a module-level asset map", () => {
    const result = runRule(
      rnPreferExpoImage,
      `import BarChart from "app/assets/images/emojis/chart-bar.png";
      import ChartIncreasing from "app/assets/images/emojis/chart-increasing.png";
      import { Image } from "react-native";
      const textMap = {
        tracks: { title: "Tracks", icon: ChartIncreasing },
        underground: { title: "Underground", icon: BarChart },
      };
      export const Drawer = ({ modalType }: { modalType: "tracks" | "underground" }) => (
        <Image source={textMap[modalType].icon} />
      );`,
      { filename: "App.tsx", settings: expoSettings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a usage with a remote uri source", () => {
    const result = runRule(
      rnPreferExpoImage,
      `import { Image } from "react-native";
      export const Avatar = ({ url }: { url: string }) => <Image source={{ uri: url }} />;`,
      { filename: "App.tsx", settings: expoSettings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags when a prop-forwarded source could be remote", () => {
    const result = runRule(
      rnPreferExpoImage,
      `import { Image } from "react-native";
      export const DrawerHeader = ({ titleImage }: { titleImage: unknown }) => (
        <Image source={titleImage} />
      );`,
      { filename: "App.tsx", settings: expoSettings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags when one of several usages is remote", () => {
    const result = runRule(
      rnPreferExpoImage,
      `import Logo from "../assets/logo.png";
      import { Image } from "react-native";
      export const Screen = ({ url }: { url: string }) => (
        <>
          <Image source={Logo} />
          <Image source={{ uri: url }} />
        </>
      );`,
      { filename: "App.tsx", settings: expoSettings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags ImageBackground with a dynamic source", () => {
    const result = runRule(
      rnPreferExpoImage,
      `import { ImageBackground } from "react-native";
      export const Hero = ({ cover }: { cover: { uri: string } }) => (
        <ImageBackground source={cover} />
      );`,
      { filename: "App.tsx", settings: expoSettings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
