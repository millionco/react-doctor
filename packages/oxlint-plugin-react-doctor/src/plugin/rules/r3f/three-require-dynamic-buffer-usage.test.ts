import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireDynamicBufferUsage } from "./three-require-dynamic-buffer-usage.js";

describe("three-require-dynamic-buffer-usage", () => {
  it.each([
    `import { BufferAttribute, WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); const attribute = new BufferAttribute(new Float32Array(9), 3); renderer.setAnimationLoop(() => { attribute.needsUpdate = true; renderer.render(scene, camera); });`,
    `import { BufferAttribute, StaticDrawUsage, WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); const attribute = new BufferAttribute(new Float32Array(9), 3); attribute.setUsage(StaticDrawUsage); renderer.setAnimationLoop(() => { attribute.needsUpdate = true; renderer.render(scene, camera); });`,
    `import { BufferAttribute, DynamicDrawUsage, WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); const attribute = new BufferAttribute(new Float32Array(9), 3); renderer.setAnimationLoop(() => { attribute.needsUpdate = true; renderer.render(scene, camera); }); attribute.setUsage(DynamicDrawUsage);`,
  ])("reports repeated uploads without a prior dynamic usage hint", (code) => {
    expect(runRule(threeRequireDynamicBufferUsage, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { BufferAttribute, DynamicDrawUsage, WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); const attribute = new BufferAttribute(new Float32Array(9), 3); attribute.setUsage(DynamicDrawUsage); renderer.setAnimationLoop(() => { attribute.needsUpdate = true; renderer.render(scene, camera); });`,
    `import { BufferAttribute, StreamDrawUsage, WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); const attribute = new BufferAttribute(new Float32Array(9), 3); attribute.setUsage(StreamDrawUsage); renderer.setAnimationLoop(() => { attribute.needsUpdate = true; renderer.render(scene, camera); });`,
    `import { BufferAttribute, WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); const attribute = new BufferAttribute(new Float32Array(9), 3); renderer.setAnimationLoop(() => { if (changed) attribute.needsUpdate = true; renderer.render(scene, camera); });`,
    `class BufferAttribute {} const attribute = new BufferAttribute(); attribute.needsUpdate = true;`,
  ])("keeps dynamic, stream, guarded, and unrelated uploads quiet", (code) => {
    expect(runRule(threeRequireDynamicBufferUsage, code).diagnostics).toHaveLength(0);
  });
});
