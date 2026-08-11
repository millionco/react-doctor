import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireAnimationMixerUpdate } from "./three-require-animation-mixer-update.js";

describe("three-require-animation-mixer-update", () => {
  it("reports mixers with actions but no loop update", () => {
    const code = `
      import { AnimationMixer, WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const mixer = new AnimationMixer(root);
      mixer.clipAction(clip).play();
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
    `;
    expect(runRule(threeRequireAnimationMixerUpdate, code).diagnostics).toHaveLength(1);
  });

  it("allows direct or delegated updates, loopless setup, and unrelated mixers", () => {
    const code = `
      import { AnimationMixer, WebGLRenderer } from "three";
      import { advanceMixer } from "./animation";
      const renderer = new WebGLRenderer();
      const direct = new AnimationMixer(root);
      direct.clipAction(clip).play();
      const delegated = new AnimationMixer(otherRoot);
      delegated.clipAction(otherClip).play();
      renderer.setAnimationLoop((time) => {
        direct.update(clock.getDelta());
        advanceMixer(delegated, time);
        renderer.render(scene, camera);
      });
      const external = new AnimationMixer(thirdRoot);
      external.clipAction(thirdClip).play();
    `;
    expect(runRule(threeRequireAnimationMixerUpdate, code).diagnostics).toHaveLength(1);
  });
});
