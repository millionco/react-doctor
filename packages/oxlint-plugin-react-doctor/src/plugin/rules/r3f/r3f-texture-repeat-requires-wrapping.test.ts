import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fTextureRepeatRequiresWrapping } from "./r3f-texture-repeat-requires-wrapping.js";

describe("r3f-texture-repeat-requires-wrapping", () => {
  it("reports repeated axes without matching wrapping", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { RepeatWrapping } from "three";
      export const Scene = () => <Canvas>
        <texture repeat={[4, 2]} />
        <texture repeat={[4, 3]} wrapS={RepeatWrapping} />
      </Canvas>;
    `;
    expect(runRule(r3fTextureRepeatRequiresWrapping, code).diagnostics).toHaveLength(3);
  });

  it("allows matching wrapping, defaults, dynamic, and spread props", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { MirroredRepeatWrapping, RepeatWrapping } from "three";
      export const Scene = (props) => <Canvas>
        <texture repeat={[4, 2]} wrapS={RepeatWrapping} wrapT={MirroredRepeatWrapping} />
        <texture repeat={[1, 1]} />
        <texture repeat={[x, y]} />
        <texture {...props} repeat={[4, 4]} />
      </Canvas>;
    `;
    expect(runRule(r3fTextureRepeatRequiresWrapping, code).diagnostics).toHaveLength(0);
  });
});
