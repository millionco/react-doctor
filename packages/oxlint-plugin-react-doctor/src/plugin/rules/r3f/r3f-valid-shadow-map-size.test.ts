import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidShadowMapSize } from "./r3f-valid-shadow-map-size.js";

describe("r3f-valid-shadow-map-size", () => {
  it("reports invalid tuple and pierced dimensions", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = () => <Canvas>
        <directionalLight castShadow shadow-mapSize={[1000, 1024]} />
        <pointLight castShadow shadow-mapSize-width={0} shadow-mapSize-height={300} />
      </Canvas>;
    `;
    expect(runRule(r3fValidShadowMapSize, code).diagnostics).toHaveLength(3);
  });

  it("allows valid, dynamic, nonshadowing, and spread lights", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = (props) => <Canvas>
        <spotLight castShadow shadow-mapSize={[1024, 2048]} />
        <spotLight castShadow shadow-mapSize={[width, height]} />
        <spotLight shadow-mapSize={[1000, 1000]} />
        <spotLight {...props} castShadow shadow-mapSize={[1000, 1000]} />
      </Canvas>;
    `;
    expect(runRule(r3fValidShadowMapSize, code).diagnostics).toHaveLength(0);
  });
});
