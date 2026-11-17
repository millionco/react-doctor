import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { resolveCrossFileValueExportWithFilePath } from "../../utils/resolve-cross-file-function-export.js";
import { rnPreferExpoImage } from "./rn-prefer-expo-image.js";
import { hasOnlyImportedBundledImageSources } from "./utils/has-only-imported-bundled-image-sources.js";

let temporaryDirectory = "";

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-imported-image-work-"));
  resetFilesystemCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const settings = {
  "react-doctor": {
    portedRuleMode: "curated",
    capabilities: ["react", "react-native"],
    framework: "expo",
  },
};

for (const imageCount of [20, 100]) {
  describe(`imported image proofs with ${imageCount} openings`, () => {
    for (const invalidExporter of [false, true]) {
      it(`reuses ${invalidExporter ? "rejected" : "accepted"} program and map proofs`, () => {
        const names = Array.from({ length: imageCount }, (_, index) => `Image${index}`);
        const imports = invalidExporter
          ? names.map((name) => `Image as ${name}`).join(",")
          : "Image";
        const openings = invalidExporter
          ? names.map((name) => `<${name} source={artworkMap.banner}/>`).join("")
          : "<Image source={artworkMap.banner}/>".repeat(imageCount);
        const code = `import {${imports}} from "react-native";import {artworkMap} from "./artwork-map";export const Gallery=()=> <>${openings}</>;`;
        const filename = path.join(temporaryDirectory, "gallery.tsx");
        fs.writeFileSync(filename, code);
        fs.writeFileSync(
          path.join(temporaryDirectory, "package.json"),
          JSON.stringify({
            dependencies: { expo: "~51.0.22", "react-native": "^0.74.3", react: "18.2.0" },
          }),
        );
        fs.writeFileSync(
          path.join(temporaryDirectory, "artwork-map.ts"),
          `import banner from "./banner.png";export const artworkMap={banner${invalidExporter ? ',remote:{uri:"https://invalid.example/remote.png"}' : ""}};`,
        );
        const parsed = parseFixture(code);
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        const cfg = analyzeControlFlow(parsed.program);
        const map = scopes.rootScope.symbols.find((symbol) => symbol.name === "artworkMap");
        const images = scopes.rootScope.symbols.filter((symbol) => symbol.name.startsWith("Image"));
        const exported = resolveCrossFileValueExportWithFilePath(
          filename,
          "./artwork-map",
          "artworkMap",
        );
        if (
          !map ||
          !exported ||
          parsed.program.type !== "Program" ||
          exported.programNode.type !== "Program"
        )
          throw new Error("Missing synthetic map provider");
        let referenceVisits = 0;
        Object.defineProperty(map, "references", {
          value: new Proxy(map.references, {
            get: (target, property, receiver) => {
              if (typeof property === "string" && /^\d+$/.test(property)) referenceVisits += 1;
              return Reflect.get(target, property, receiver);
            },
          }),
        });
        let programReads = 0;
        const body = parsed.program.body;
        Object.defineProperty(parsed.program, "body", {
          enumerable: true,
          get: () => {
            programReads += 1;
            return body;
          },
        });
        let exporterReads = 0;
        const exporterBody = exported.programNode.body;
        Object.defineProperty(exported.programNode, "body", {
          enumerable: true,
          get: () => {
            exporterReads += 1;
            return exporterBody;
          },
        });
        for (const image of images) {
          const admitted = hasOnlyImportedBundledImageSources({
            specifier: image.declarationNode,
            context: { filename, scopes, cfg, report: () => undefined },
            bundledAssetSourcePattern: /\.png$/i,
          });
          expect(admitted).toBe(!invalidExporter);
        }
        expect(parsed.errors).toEqual([]);
        expect(programReads).toBe(1);
        expect(exporterReads).toBeLessThanOrEqual(3);
        expect(referenceVisits).toBe(invalidExporter ? 0 : imageCount);
        resetFilesystemCaches();
        expect(runRule(rnPreferExpoImage, code, { filename, settings }).diagnostics).toHaveLength(
          invalidExporter ? imageCount : 0,
        );
      });
    }
  });
}

for (const mapCount of [20, 100]) {
  it(`indexes consumer aliases once for ${mapCount} distinct maps`, () => {
    const names = Array.from({ length: mapCount }, (_, index) => `artworkMap${index}`);
    const exporter = names
      .map(
        (name, index) =>
          `import asset${index} from "./banner.png";export const ${name}={banner:asset${index}};`,
      )
      .join("");
    const code = `import {Image} from "react-native";import {${names.join(",")}} from "./artwork-map";export const Gallery=()=> <>${names.map((name) => `<Image source={${name}.banner}/>`).join("")}</>;`;
    const filename = path.join(temporaryDirectory, "gallery.tsx");
    fs.writeFileSync(filename, code);
    fs.writeFileSync(path.join(temporaryDirectory, "artwork-map.ts"), exporter);
    const parsed = parseFixture(code);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const cfg = analyzeControlFlow(parsed.program);
    const image = scopes.rootScope.symbols.find((symbol) => symbol.name === "Image");
    if (!image) throw new Error("Missing synthetic Image provider");
    let consumerSymbolVisits = 0;
    Object.defineProperty(scopes.rootScope, "symbols", {
      value: new Proxy(scopes.rootScope.symbols, {
        get: (target, property, receiver) => {
          if (typeof property === "string" && /^\d+$/.test(property)) consumerSymbolVisits += 1;
          return Reflect.get(target, property, receiver);
        },
      }),
    });
    expect(
      hasOnlyImportedBundledImageSources({
        specifier: image.declarationNode,
        context: { filename, scopes, cfg, report: () => undefined },
        bundledAssetSourcePattern: /\.png$/i,
      }),
    ).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(consumerSymbolVisits).toBeLessThanOrEqual((mapCount + 2) * 2);
    resetFilesystemCaches();
    expect(runRule(rnPreferExpoImage, code, { filename, settings }).diagnostics).toHaveLength(0);
    resetFilesystemCaches();
    const remote = code.replace(
      "</>",
      '<Image source={{uri:"https://invalid.example/remote.png"}}/></>',
    );
    expect(runRule(rnPreferExpoImage, remote, { filename, settings }).diagnostics).toHaveLength(1);
  });
}
