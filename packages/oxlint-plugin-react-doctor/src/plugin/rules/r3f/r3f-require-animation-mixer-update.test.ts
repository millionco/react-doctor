import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireAnimationMixerUpdate } from "./r3f-require-animation-mixer-update.js";

describe("r3f-require-animation-mixer-update", () => {
  it("reports mixers with actions but no useFrame update", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { AnimationMixer } from "three";
      export const Scene = ({ root, clip }) => {
        const mixer = new AnimationMixer(root);
        mixer.clipAction(clip).play();
        useFrame(() => updateScene());
        return null;
      };
    `;
    expect(runRule(r3fRequireAnimationMixerUpdate, code).diagnostics).toHaveLength(1);
  });

  it("allows direct and delegated frame updates and shadowed hooks", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { AnimationMixer } from "three";
      export const Scene = ({ root, clip }) => {
        const mixer = new AnimationMixer(root);
        mixer.clipAction(clip).play();
        useFrame((state, delta) => mixer.update(delta));
        return null;
      };
      const unrelated = (useFrame, root, clip) => {
        const mixer = new AnimationMixer(root);
        mixer.clipAction(clip).play();
        useFrame(() => updateScene());
      };
    `;
    expect(runRule(r3fRequireAnimationMixerUpdate, code).diagnostics).toHaveLength(0);
  });
});
