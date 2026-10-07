import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeEffectComposerOutputPassLast } from "./three-effect-composer-output-pass-last.js";

describe("three-effect-composer-output-pass-last", () => {
  it.each([
    `import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; import { OutputPass } from "three/addons/postprocessing/OutputPass.js"; import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"; const composer = new EffectComposer(renderer); composer.addPass(new OutputPass()); composer.addPass(new ShaderPass(shader));`,
    `import * as Addons from "three/addons"; const composer = new Addons.EffectComposer(renderer); const output = new Addons.OutputPass(); const bloom = new Addons.UnrealBloomPass(); composer.addPass(output); composer.addPass(bloom);`,
  ])("reports a pass added after OutputPass", (code) => {
    expect(runRule(threeEffectComposerOutputPassLast, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; import { OutputPass } from "three/addons/postprocessing/OutputPass.js"; import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"; const composer = new EffectComposer(renderer); composer.addPass(new ShaderPass(shader)); composer.addPass(new OutputPass());`,
    `import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; import { OutputPass } from "three/addons/postprocessing/OutputPass.js"; import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"; const composer = new EffectComposer(renderer); if (debug) composer.addPass(new OutputPass()); composer.addPass(new ShaderPass(shader));`,
    `import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; import { OutputPass } from "three/addons/postprocessing/OutputPass.js"; import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"; const first = new EffectComposer(renderer); const second = new EffectComposer(renderer); first.addPass(new OutputPass()); second.addPass(new ShaderPass(shader));`,
    `class EffectComposer { addPass() {} } class OutputPass {} const composer = new EffectComposer(); composer.addPass(new OutputPass()); composer.addPass(pass);`,
  ])("keeps last, conditional, separate, and unrelated pass chains quiet", (code) => {
    expect(runRule(threeEffectComposerOutputPassLast, code).diagnostics).toHaveLength(0);
  });
});
