import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeEffectComposerRequireSizeOnResize } from "./three-effect-composer-require-size-on-resize.js";

describe("three-effect-composer-require-size-on-resize", () => {
  it.each([
    `import { WebGLRenderer } from "three"; import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; const renderer = new WebGLRenderer(); const composer = new EffectComposer(renderer); window.addEventListener("resize", () => renderer.setSize(innerWidth, innerHeight));`,
    `import * as THREE from "three"; import * as Addons from "three/addons"; const renderer = new THREE.WebGLRenderer(); const composer = new Addons.EffectComposer(renderer); const resize = () => { renderer.setSize(width, height); }; window.onresize = resize;`,
    `import { WebGLRenderer } from "three"; import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; const renderer = new WebGLRenderer(); const first = new EffectComposer(renderer); const second = new EffectComposer(renderer); window.addEventListener("resize", () => { renderer.setSize(width, height); first.setSize(width, height); });`,
  ])("reports composers omitted from a renderer resize", (code) => {
    expect(runRule(threeEffectComposerRequireSizeOnResize, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { WebGLRenderer } from "three"; import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; const renderer = new WebGLRenderer(); const composer = new EffectComposer(renderer); window.addEventListener("resize", () => { renderer.setSize(width, height); composer.setSize(width, height); });`,
    `import { WebGLRenderer } from "three"; import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; const renderer = new WebGLRenderer(); let composer: EffectComposer | undefined = new EffectComposer(renderer); window.addEventListener("resize", () => { renderer.setSize(width, height); composer?.setSize(width, height); });`,
    `import { WebGLRenderer } from "three"; import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; const renderer = new WebGLRenderer(); let composer: EffectComposer | null = null; if (enabled) { const nextComposer = new EffectComposer(renderer); composer = nextComposer; } window.addEventListener("resize", () => { renderer.setSize(width, height); composer?.setSize(width, height); });`,
    `import { WebGLRenderer } from "three"; import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; import { resizeComposer } from "./resize.js"; const renderer = new WebGLRenderer(); const composer = new EffectComposer(renderer); window.addEventListener("resize", () => { renderer.setSize(width, height); resizeComposer(composer, width, height); });`,
    `import { WebGLRenderer } from "three"; import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; const firstRenderer = new WebGLRenderer(); const secondRenderer = new WebGLRenderer(); const composer = new EffectComposer(firstRenderer); window.addEventListener("resize", () => secondRenderer.setSize(width, height));`,
    `class EffectComposer {} class WebGLRenderer { setSize() {} } const renderer = new WebGLRenderer(); const composer = new EffectComposer(renderer); window.onresize = () => renderer.setSize(1, 1);`,
  ])("case %# keeps synchronized, delegated, separate, and unrelated pipelines quiet", (code) => {
    expect(runRule(threeEffectComposerRequireSizeOnResize, code).diagnostics).toHaveLength(0);
  });
});
