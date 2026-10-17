import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { rnPreferExpoImage } from "./rn-prefer-expo-image.js";

let temporaryDirectory = "";

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-imported-image-bindings-"));
  resetFilesystemCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const cases = [
  {
    name: "nominal",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 0,
  },
  {
    name: "merged-imported-map-interface",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\ninterface artworkMap {}\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 0,
  },
  {
    name: "inner-readonly-map-interface",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => {interface artworkMap {}return <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;};\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 0,
  },
  {
    name: "merged-image-interface",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\ninterface Image {}\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 0,
  },
  {
    name: "merged-map-type-alias",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\ntype artworkMap = unknown;\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 0,
  },
  {
    name: "exported-map-interface",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\nexport interface artworkMap {}\n',
    expectedCount: 0,
  },
  {
    name: "merged-asset-interface",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'interface banner {}\nimport banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 0,
  },
  {
    name: "masked-importer-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\n(()=>{interface artworkMap {}artworkMap.banner={uri:"https://invalid.example/remote.png"};})();\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 1,
  },
  {
    name: "masked-exporter-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n(()=>{interface artworkMap {}artworkMap.banner={uri:"https://invalid.example/remote.png"};})();\n',
    expectedCount: 1,
  },
  {
    name: "genuine-local-map-shadow",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => {const artworkMap={banner:{uri:"https://invalid.example/remote.png"},tick:1};return <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;};\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 1,
  },
  {
    name: "closure-nominal-map",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 0,
  },
  {
    name: "closure-global-module-map-write",
    code: 'module.require("./artwork-map").artworkMap.banner = externalAsset;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 1,
  },
  {
    name: "closure-global-module-native-provider-write",
    code: 'module.require("react-native").Image = externalImage;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 1,
  },
  {
    name: "closure-actual-local-module-control",
    code: 'const module = { require: () => ({artworkMap: {banner: 1}}) }; module.require("./artwork-map").artworkMap.banner = externalAsset;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 0,
  },
  {
    name: "closure-exporter-global-module-native-provider-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\nmodule.require("react-native").Image = externalImage;\n',
    expectedCount: 1,
  },
  {
    name: "closure-global-require-existing-guard",
    code: 'require("./artwork-map").artworkMap.banner = externalAsset;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 1,
  },
  {
    name: "erased-global-module",
    code: 'interface module {}\nmodule.require("react-native").Image=externalImage;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 1,
  },
  {
    name: "merged-local-module",
    code: 'const module={require:()=>({Image:1})};interface module {}\nmodule.require("react-native").Image=externalImage;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 0,
  },
  {
    name: "inert-module-key",
    code: 'const metadata={module:"label"};void metadata.module;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    exporter:
      'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
    expectedCount: 0,
  },
];

describe("runtime bindings in imported bundled image maps", () => {
  it.each(cases)("$name", (testCase) => {
    fs.writeFileSync(path.join(temporaryDirectory, "artwork-map.ts"), testCase.exporter);
    fs.writeFileSync(path.join(temporaryDirectory, "gallery.tsx"), testCase.code);
    fs.writeFileSync(
      path.join(temporaryDirectory, "package.json"),
      JSON.stringify({
        name: "synthetic-image-map-bindings",
        dependencies: { expo: "~51.0.22", "react-native": "^0.74.3", react: "18.2.0" },
      }),
    );
    const result = runRule(rnPreferExpoImage, testCase.code, {
      filename: path.join(temporaryDirectory, "gallery.tsx"),
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-native"],
          framework: "expo",
        },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(testCase.expectedCount);
  });
});
