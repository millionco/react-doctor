import { describe, expect, it } from "vite-plus/test";
import { buildCapabilities } from "../src/capabilities/build-capabilities.js";
import { buildDependencyGraphFromManifest } from "../src/dependency-graph/build-dependency-graph.js";

describe("capability derivation from the dependency graph", () => {
  it("emits cumulative react majors and framework tokens", () => {
    const graph = buildDependencyGraphFromManifest({
      dependencies: { next: "15.0.0", react: "19.2.0" },
      devDependencies: { typescript: "^5.6.0", tailwindcss: "^3.4.0" },
    });
    const capabilities = buildCapabilities(graph);

    expect(capabilities.has("nextjs")).toBe(true);
    expect(capabilities.has("react:17")).toBe(true);
    expect(capabilities.has("react:18")).toBe(true);
    expect(capabilities.has("react:19")).toBe(true);
    expect(capabilities.has("react:19.2")).toBe(true);
    expect(capabilities.has("typescript")).toBe(true);
    expect(capabilities.has("tailwind")).toBe(true);
    expect(capabilities.has("tailwind:3.4")).toBe(true);
  });

  it("flags tanstack-query, react-compiler, and react-native", () => {
    const graph = buildDependencyGraphFromManifest({
      dependencies: { react: "19.0.0", "@tanstack/react-query": "^5", "react-native": "0.76.0" },
      devDependencies: { "babel-plugin-react-compiler": "^1" },
    });
    const capabilities = buildCapabilities(graph);

    expect(capabilities.has("tanstack-query")).toBe(true);
    expect(capabilities.has("react-compiler")).toBe(true);
    expect(capabilities.has("react-native")).toBe(true);
  });

  it("treats Preact-without-React as pure-preact", () => {
    const graph = buildDependencyGraphFromManifest({ dependencies: { preact: "10.0.0" } });
    const capabilities = buildCapabilities(graph);
    expect(capabilities.has("preact")).toBe(true);
    expect(capabilities.has("pure-preact")).toBe(true);
  });
});
