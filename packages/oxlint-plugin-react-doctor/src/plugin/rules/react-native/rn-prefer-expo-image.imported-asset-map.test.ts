import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { rnPreferExpoImage } from "./rn-prefer-expo-image.js";

interface ImportedImageMapCase {
  name: string;
  code: string;
  files: Readonly<Record<string, string>>;
  expectedCount: number;
}

let temporaryDirectory = "";

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-imported-image-map-"));
  resetFilesystemCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFixtureFiles = (files: Readonly<Record<string, string>>): void => {
  for (const [relativePath, contents] of Object.entries(files)) {
    const filename = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(
      filename,
      relativePath.endsWith(".png") ? Buffer.from(contents, "base64") : contents,
    );
  }
};

const settings = {
  "react-doctor": {
    portedRuleMode: "curated",
    capabilities: ["react", "react-native"],
    framework: "expo",
  },
};

const cases: ReadonlyArray<ImportedImageMapCase> = [
  {
    name: "same-file-direct-asset",
    code: 'import { Image } from "react-native";\nimport banner from "./assets/banner.png";\nexport const Gallery = () => <Image source={banner} />;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport banner from "./assets/banner.png";\nexport const Gallery = () => <Image source={banner} />;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-0",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "same-file-local-map",
    code: 'import { Image } from "react-native";\nimport banner from "./assets/banner.png";\nconst artworkMap = { banner };\nexport const Gallery = () => <Image source={artworkMap.banner} />;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport banner from "./assets/banner.png";\nconst artworkMap = { banner };\nexport const Gallery = () => <Image source={artworkMap.banner} />;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-1",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "relative-imported-map",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "tsconfig-alias-imported-map",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "@/artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "@/artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-3",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "mixed-remote-selected-property",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick: { uri: "https://invalid.example/synthetic.png" } };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-4",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "exporter-property-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\nartworkMap.banner = externalAsset;\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-5",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "consumer-property-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nartworkMap.banner = externalAsset;\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nartworkMap.banner = externalAsset;\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-6",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "whole-map-opaque-transport",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nobserve(artworkMap);\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nobserve(artworkMap);\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-7",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "duplicate-static-map-key",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick, banner: externalAsset };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-8",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "getter-map-provider",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { get banner() { return externalAsset; }, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-9",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "type-only-runtime-map-reference",
    code: 'import { Image } from "react-native";\nimport type { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport type { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-10",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "missing-local-map-module",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-11",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "jsx-later-source-spread",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} {...properties} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} {...properties} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-12",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "module-content-invalidation-profile",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner: tick, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-13",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "nested-erased-map-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nconst replaceArtwork = () => { interface artworkMap {}; artworkMap.banner = externalAsset; };\nreplaceArtwork();\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nconst replaceArtwork = () => { interface artworkMap {}; artworkMap.banner = externalAsset; };\nreplaceArtwork();\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-14",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "exporter-alias-and-delete",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\nconst exposedArtwork = artworkMap;\ndelete exposedArtwork.banner;\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-15",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "duplicate-selected-image-source",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} source={externalAsset} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} source={externalAsset} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-16",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "alias-alternate-missing-target",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "@/artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "@/artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-17",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "missing/*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "renamed-named-map-import",
    code: 'import { Image } from "react-native";\nimport { artworkMap as covers } from "./artwork-map";\nexport const Gallery = () => <><Image source={covers.banner} /><Image source={covers.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap as covers } from "./artwork-map";\nexport const Gallery = () => <><Image source={covers.banner} /><Image source={covers.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "unused-namespace-map-companion",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport * as unusedArtwork from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport * as unusedArtwork from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "namespace-map-import",
    code: 'import { Image } from "react-native";\nimport * as collection from "./artwork-map";\nexport const Gallery = () => <><Image source={collection.artworkMap.banner} /><Image source={collection.artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport * as collection from "./artwork-map";\nexport const Gallery = () => <><Image source={collection.artworkMap.banner} /><Image source={collection.artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "default-map-import",
    code: 'import { Image } from "react-native";\nimport artworkMap from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport artworkMap from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "barrel-map-import",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./barrel";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./barrel";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
      "barrel.ts": 'export { artworkMap } from "./artwork-map";\n',
    },
    expectedCount: 1,
  },
  {
    name: "spread-map-provider",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick, ...additionalArtwork };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "computed-static-map-provider",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { ["banner"]: banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "mutable-let-map-provider",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport let artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "type-only-selected-asset-import",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import type banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "export-list-map-provider",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nconst artworkMap = { banner, tick };\nexport { artworkMap };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "consumer-map-alias-transport",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nconst otherArtwork = artworkMap;\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nconst otherArtwork = artworkMap;\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "nested-erased-typealias-map-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nconst replaceArtwork = () => { type artworkMap = unknown; artworkMap.banner = externalAsset; };\nreplaceArtwork();\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nconst replaceArtwork = () => { type artworkMap = unknown; artworkMap.banner = externalAsset; };\nreplaceArtwork();\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "nested-erased-jsx-image-provider",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\nexport const Other = () => { interface Image {}; return <Image source={externalAsset}/>; };\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\nexport const Other = () => { interface Image {}; return <Image source={externalAsset}/>; };\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "ambient-program-provider",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\ndeclare const unusedProvider: unknown;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\ndeclare const unusedProvider: unknown;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "direct-eval-provider",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\neval("artworkMap.banner = externalAsset");\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\neval("artworkMap.banner = externalAsset");\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "erased-eval-mask-provider",
    code: 'interface eval {};\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\neval("artworkMap.banner = externalAsset");\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'interface eval {};\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\neval("artworkMap.banner = externalAsset");\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "unknown-computed-provider-key",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\nconst carrier = ""[providerKey]; observe(carrier);\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\nconst carrier = ""[providerKey]; observe(carrier);\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "resolved-computed-constructor-provider",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\nconst providerKey = "constructor"; const carrier = ""[providerKey]; observe(carrier);\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\nconst providerKey = "constructor"; const carrier = ""[providerKey]; observe(carrier);\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "secondary-named-map-alias-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport { artworkMap as secondArtwork } from "./artwork-map";\nsecondArtwork.banner = externalAsset;\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport { artworkMap as secondArtwork } from "./artwork-map";\nsecondArtwork.banner = externalAsset;\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "secondary-namespace-map-exposure",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport * as secondArtwork from "./artwork-map";\nobserve(secondArtwork);\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport * as secondArtwork from "./artwork-map";\nobserve(secondArtwork);\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "same-module-alternate-path-alias-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport { artworkMap as secondArtwork } from "./artwork-map.ts";\nsecondArtwork.banner = externalAsset;\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport { artworkMap as secondArtwork } from "./artwork-map.ts";\nsecondArtwork.banner = externalAsset;\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "two-native-image-import-exposures-retain-both",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport { Image as OtherImage } from "react-native";\nobserve(OtherImage);\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport { Image as OtherImage } from "react-native";\nobserve(OtherImage);\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 2,
  },
  {
    name: "native-namespace-provider-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport * as Native from "react-native";\nNative.Image = replacementImage;\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nimport * as Native from "react-native";\nNative.Image = replacementImage;\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "jsx-prior-spread-unsupported",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image {...properties} source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image {...properties} source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "image-background-static-map",
    code: 'import { ImageBackground } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><ImageBackground source={artworkMap.banner} /><ImageBackground source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { ImageBackground } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><ImageBackground source={artworkMap.banner} /><ImageBackground source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "lexical-native-image-shadow",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\nexport const Other = () => { const Image = CustomImage; return <Image source={externalAsset}/>; };\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\nexport const Other = () => { const Image = CustomImage; return <Image source={externalAsset}/>; };\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "lexical-map-shadow-source",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => { const artworkMap = { banner: externalAsset }; return <Image source={artworkMap.banner}/>; };\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => { const artworkMap = { banner: externalAsset }; return <Image source={artworkMap.banner}/>; };\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "dynamic-map-selector",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap[activeName]} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap[activeName]} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "optional-map-selector",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap?.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap?.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "no-native-image-usage",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => null;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => null;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "unknown-exported-property-provider",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner: buildArtwork(), tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "selected-asset-property-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\nbanner.uri = "https://invalid.example/synthetic.png";\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "exporter-reflection-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\nReflect.set(artworkMap, "banner", externalAsset);\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "exported-map-default-escape",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\nexport default artworkMap;\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "unrelated-erased-declarations",
    code: 'interface Unrelated { title: string };\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'type UnrelatedAsset = string;\nimport banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'interface Unrelated { title: string };\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "unrelated-local-object-shadow",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\nconst Object = { label: "local" }; void Object.label;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\nconst Object = { label: "local" }; void Object.label;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "unused-type-import-companion",
    code: 'import type { UnrelatedType } from "./unknown-type";\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import type { UnrelatedType } from "./unknown-type";\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "erased-runtime-type-import-map-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nconst replaceArtwork = () => { type artworkMap = never; artworkMap.tick = externalAsset; };\nreplaceArtwork();\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nconst replaceArtwork = () => { type artworkMap = never; artworkMap.tick = externalAsset; };\nreplaceArtwork();\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "parenthesized-imported-source",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={(artworkMap.banner)} /><Image source={(artworkMap.tick)} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={(artworkMap.banner)} /><Image source={(artworkMap.tick)} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "transparent-map-and-value-wrappers",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={(artworkMap).banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = ({ banner: (banner), tick: (tick) });\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={(artworkMap).banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "asset-import-opaque-exposure",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\nobserve(banner);\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "asset-import-local-alias-exposure",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\nconst exposedArtwork = banner; observe(exposedArtwork);\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "named-default-native-provider-write",
    code: 'import {default as NativeModule} from "react-native"; NativeModule.Image=replacementImage;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import {default as NativeModule} from "react-native"; NativeModule.Image=replacementImage;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "named-default-native-provider-opaque-exposure",
    code: 'import {default as NativeModule} from "react-native"; observe(NativeModule);\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import {default as NativeModule} from "react-native"; observe(NativeModule);\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "unused-named-default-native-provider",
    code: 'import {default as NativeModule} from "react-native";\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import {default as NativeModule} from "react-native";\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "constructor-object-pattern-program-screen",
    code: 'const {constructor: createCallback}=()=>{}; createCallback("void 0")();\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'const {constructor: createCallback}=()=>{}; createCallback("void 0")();\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "const-key-constructor-pattern-program-screen",
    code: 'const propertyName="constructor"; const {[propertyName]: createCallback}=()=>{}; createCallback("void 0")();\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'const propertyName="constructor"; const {[propertyName]: createCallback}=()=>{}; createCallback("void 0")();\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "ordinary-safe-object-pattern",
    code: 'const { label } = { label: "ready" }; void label;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'const { label } = { label: "ready" }; void label;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
  {
    name: "unknown-computed-object-pattern",
    code: 'const selectedProperty = unknownProperty; const { [selectedProperty]: providerValue } = () => {}; void providerValue;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'const selectedProperty = unknownProperty; const { [selectedProperty]: providerValue } = () => {}; void providerValue;\nimport { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "exporter-native-default-provider-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import NativeProvider from "react-native";\nNativeProvider.Image = replacementImage;\nimport banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "exporter-native-default-provider-escape",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import NativeProvider from "react-native";\nobserve(NativeProvider);\nimport banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "exporter-native-named-default-provider-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import { default as NativeProvider } from "react-native";\nNativeProvider.Image = replacementImage;\nimport banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "exporter-native-named-default-provider-escape",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import { default as NativeProvider } from "react-native";\nobserve(NativeProvider);\nimport banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "exporter-native-namespace-provider-write",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import * as NativeProvider from "react-native";\nNativeProvider.Image = replacementImage;\nimport banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "exporter-native-namespace-provider-escape",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import * as NativeProvider from "react-native";\nobserve(NativeProvider);\nimport banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 1,
  },
  {
    name: "exporter-unused-native-providers",
    code: 'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
    files: {
      "artwork-map.ts":
        'import UnusedNativeProvider from "react-native";\nimport { default as UnusedNamedNativeProvider } from "react-native";\nimport * as UnusedNativeNamespace from "react-native";\nimport banner from "./assets/banner.png";\nimport tick from "./assets/tick.png";\nexport const artworkMap = { banner, tick };\n',
      "assets/banner.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "assets/tick.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVQAAAABJRU5ErkJggg==",
      "gallery.tsx":
        'import { Image } from "react-native";\nimport { artworkMap } from "./artwork-map";\nexport const Gallery = () => <><Image source={artworkMap.banner} /><Image source={artworkMap.tick} /></>;\n',
      "package.json":
        '{\n  "name": "synthetic-asset-map-2",\n  "private": true,\n  "dependencies": {\n    "expo": "~51.0.22",\n    "react-native": "^0.74.3",\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {\n      "@/*": [\n        "./*"\n      ]\n    }\n  }\n}\n',
    },
    expectedCount: 0,
  },
];

describe("imported bundled image map sources", () => {
  it.each(cases)("$name", (testCase) => {
    writeFixtureFiles(testCase.files);
    const result = runRule(rnPreferExpoImage, testCase.code, {
      filename: path.join(temporaryDirectory, "gallery.tsx"),
      forceJsx: false,
      includeLocations: true,
      settings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(testCase.expectedCount);
  });
});

describe("imported bundled image map dependency changes", () => {
  it("records the module and replays its probes on a collector memo hit", () => {
    const testCase = cases[2];
    writeFixtureFiles(testCase.files);
    const filename = path.join(temporaryDirectory, "gallery.tsx");
    const first = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: testCase.code,
      ruleIds: ["rn-prefer-expo-image"],
    });
    const second = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: testCase.code,
      ruleIds: ["rn-prefer-expo-image"],
    });
    for (const trace of [first, second]) {
      expect(trace?.contentPaths.has(path.join(temporaryDirectory, "package.json"))).toBe(true);
      expect(trace?.contentPaths.has(path.join(temporaryDirectory, "artwork-map.ts"))).toBe(true);
      expect(trace?.existencePaths.has(path.join(temporaryDirectory, "artwork-map"))).toBe(true);
    }
  });

  it("uses changed exporter content on the next filesystem-cache pass", () => {
    const testCase = cases[2];
    writeFixtureFiles(testCase.files);
    const filename = path.join(temporaryDirectory, "gallery.tsx");
    const first = runRule(rnPreferExpoImage, testCase.code, { filename, settings });
    expect(first.parseErrors).toEqual([]);
    expect(first.diagnostics).toEqual([]);
    writeFixtureFiles({
      "artwork-map.ts":
        'export const artworkMap = { banner: { uri: "https://invalid.example/remote.png" }, tick: 1 };',
    });
    resetFilesystemCaches();
    const second = runRule(rnPreferExpoImage, testCase.code, { filename, settings });
    expect(second.parseErrors).toEqual([]);
    expect(second.diagnostics).toHaveLength(1);
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: testCase.code,
      ruleIds: ["rn-prefer-expo-image"],
    });
    expect(trace?.contentPaths.has(path.join(temporaryDirectory, "artwork-map.ts"))).toBe(true);
  });

  it("uses changed alias configuration and records both the config and selected module", () => {
    const testCase = cases[3];
    writeFixtureFiles(testCase.files);
    const filename = path.join(temporaryDirectory, "gallery.tsx");
    expect(runRule(rnPreferExpoImage, testCase.code, { filename, settings }).diagnostics).toEqual(
      [],
    );
    writeFixtureFiles({
      "tsconfig.json":
        '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["alternate/*"] } } }',
      "alternate/artwork-map.ts":
        "export const artworkMap = { banner: unknownArtwork, tick: unknownArtwork };",
    });
    resetFilesystemCaches();
    const result = runRule(rnPreferExpoImage, testCase.code, { filename, settings });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: testCase.code,
      ruleIds: ["rn-prefer-expo-image"],
    });
    expect(trace?.contentPaths.has(path.join(temporaryDirectory, "tsconfig.json"))).toBe(true);
    expect(trace?.contentPaths.has(path.join(temporaryDirectory, "alternate/artwork-map.ts"))).toBe(
      true,
    );
  });

  it("tracks a missing module appearing and disappearing between filesystem-cache passes", () => {
    const testCase = cases[2];
    const files = { ...testCase.files };
    delete files["artwork-map.ts"];
    writeFixtureFiles(files);
    const filename = path.join(temporaryDirectory, "gallery.tsx");
    const missing = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: testCase.code,
      ruleIds: ["rn-prefer-expo-image"],
    });
    expect(missing?.existencePaths.has(path.join(temporaryDirectory, "artwork-map.ts"))).toBe(true);
    expect(
      runRule(rnPreferExpoImage, testCase.code, { filename, settings }).diagnostics,
    ).toHaveLength(1);
    writeFixtureFiles({ "artwork-map.ts": testCase.files["artwork-map.ts"] });
    resetFilesystemCaches();
    expect(runRule(rnPreferExpoImage, testCase.code, { filename, settings }).diagnostics).toEqual(
      [],
    );
    fs.unlinkSync(path.join(temporaryDirectory, "artwork-map.ts"));
    resetFilesystemCaches();
    expect(
      runRule(rnPreferExpoImage, testCase.code, { filename, settings }).diagnostics,
    ).toHaveLength(1);
  });

  it("records namespace alias fallback existence when an alternate module disappears", () => {
    const testCase = cases[2];
    const code =
      'import * as linkedArtwork from "@linked"; observe(linkedArtwork);\n' + testCase.code;
    writeFixtureFiles({
      ...testCase.files,
      "gallery.tsx": code,
      "alternate-map.ts": "export const separateArtwork = {};",
      "tsconfig.json":
        '{ "compilerOptions": { "baseUrl": ".", "paths": { "@linked": ["alternate-map.ts", "artwork-map.ts"] } } }',
    });
    const filename = path.join(temporaryDirectory, "gallery.tsx");
    const alternateFilename = path.join(temporaryDirectory, "alternate-map.ts");
    const initial = runRule(rnPreferExpoImage, code, { filename, settings });
    expect(initial.parseErrors).toEqual([]);
    expect(initial.diagnostics).toEqual([]);
    const cold = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: code,
      ruleIds: ["rn-prefer-expo-image"],
    });
    const memoized = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: code,
      ruleIds: ["rn-prefer-expo-image"],
    });
    expect(cold?.existencePaths.has(alternateFilename)).toBe(true);
    expect(memoized?.existencePaths.has(alternateFilename)).toBe(true);
    fs.unlinkSync(alternateFilename);
    resetFilesystemCaches();
    const changed = runRule(rnPreferExpoImage, code, { filename, settings });
    expect(changed.parseErrors).toEqual([]);
    expect(changed.diagnostics).toHaveLength(1);
    const after = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: code,
      ruleIds: ["rn-prefer-expo-image"],
    });
    expect(after?.existencePaths.has(alternateFilename)).toBe(true);
    expect(after?.contentPaths.has(path.join(temporaryDirectory, "artwork-map.ts"))).toBe(true);
  });
});
