import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequirePostprocessingCleanup } from "./three-require-postprocessing-cleanup.js";

const THREE_146_SETTINGS = {
  "react-doctor": {
    capabilities: [
      "three",
      "three:145",
      "three:146",
      "three:147",
      "three:153",
      "three:160",
      "three:164",
      "three:177",
    ],
  },
};

const runThreePostprocessingRule = (code: string) =>
  runRule(threeRequirePostprocessingCleanup, code, { settings: THREE_146_SETTINGS });

describe("three-require-postprocessing-cleanup", () => {
  it("does not require R3F for plain React and Three.js projects", () => {
    expect(threeRequirePostprocessingCleanup.requires).toBeUndefined();
  });

  it("reports Three and pmndrs composers without cleanup", () => {
    const code = `
      import { useMemo } from "react";
      import { EffectComposer as ThreeComposer } from "three/addons/postprocessing/EffectComposer.js";
      import { EffectComposer as LegacyPathComposer } from "three/examples/jsm/postprocessing/EffectComposer";
      import { EffectComposer as PmndrsComposer } from "postprocessing";
      function Scene({ renderer }) {
        const first = useMemo(() => new ThreeComposer(renderer), [renderer]);
        const second = useMemo(() => new LegacyPathComposer(renderer), [renderer]);
        const third = useMemo(() => new PmndrsComposer(renderer), [renderer]);
        first.render();
        second.render();
        third.render();
        return null;
      }
    `;
    expect(runThreePostprocessingRule(code).diagnostics).toHaveLength(3);
  });

  it("reports exact resource-owning passes through both Three export paths", () => {
    const code = `
      import { useMemo } from "react";
      import { ShaderPass as Shader } from "three/addons/postprocessing/ShaderPass.js";
      import * as Bloom from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
      import { OutputPass } from "three/addons/postprocessing/OutputPass";
      import { AdaptiveToneMappingPass } from "three/examples/jsm/postprocessing/AdaptiveToneMappingPass";
      function Scene({ shader }) {
        const first = useMemo(() => new Shader(shader), [shader]);
        const second = useMemo(() => new Bloom.UnrealBloomPass(), []);
        const third = useMemo(() => new OutputPass(), []);
        const fourth = useMemo(() => new AdaptiveToneMappingPass(), []);
        return first.enabled || second.enabled || third.enabled || fourth.enabled;
      }
    `;
    expect(runThreePostprocessingRule(code).diagnostics).toHaveLength(4);
  });

  it("requires Three composers and their borrowed passes to be disposed separately", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
      import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
      function Complete({ renderer, shader }) {
        const composer = useMemo(() => new EffectComposer(renderer), [renderer]);
        const pass = useMemo(() => new ShaderPass(shader), [shader]);
        composer.addPass(pass);
        useEffect(() => () => {
          pass.dispose();
          composer.dispose();
        }, [composer, pass]);
        return null;
      }
      function MissingPassCleanup({ renderer, shader }) {
        const composer = useMemo(() => new EffectComposer(renderer), [renderer]);
        const pass = useMemo(() => new ShaderPass(shader), [shader]);
        composer.insertPass(pass, 0);
        useEffect(() => () => composer.dispose(), [composer]);
        return null;
      }
      function MissingComposerCleanup({ renderer, shader }) {
        const composer = useMemo(() => new EffectComposer(renderer), [renderer]);
        const pass = useMemo(() => new ShaderPass(shader), [shader]);
        composer.addPass(pass);
        useEffect(() => () => pass.dispose(), [pass]);
        return null;
      }
    `;
    expect(runThreePostprocessingRule(code).diagnostics).toHaveLength(2);
  });

  it("accepts effect-owned disposal and guarded lazy ref disposal", () => {
    const code = `
      import { useEffect, useRef } from "react";
      import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
      import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
      function EffectOwned({ renderer }) {
        useEffect(() => {
          const composer = new EffectComposer(renderer);
          return () => composer.dispose();
        }, [renderer]);
        return null;
      }
      function RefOwned() {
        const passRef = useRef(new UnrealBloomPass());
        useEffect(() => () => passRef.current.dispose(), []);
        return null;
      }
      function LazyRefOwned() {
        const passRef = useRef(null);
        if (!passRef.current) passRef.current = new UnrealBloomPass();
        useEffect(() => () => passRef.current.dispose(), []);
        return null;
      }
    `;
    expect(runThreePostprocessingRule(code).diagnostics).toHaveLength(1);
  });

  it("requires unconditional React-owned disposal", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
      function useReturnedDisposer(renderer) {
        const composer = useMemo(() => new EffectComposer(renderer), [renderer]);
        return () => composer.dispose();
      }
      function Conditional({ enabled, renderer }) {
        const composer = useMemo(() => new EffectComposer(renderer), [renderer]);
        useEffect(() => () => {
          if (enabled) composer.dispose();
        }, [composer, enabled]);
        return null;
      }
    `;
    expect(runThreePostprocessingRule(code).diagnostics).toHaveLength(2);
  });

  it("keeps unrelated addPass transfers and escaped composers quiet", () => {
    const code = `
      import { useMemo } from "react";
      import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
      import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
      function Scene({ manager, renderer, shader }) {
        const unrelatedPass = useMemo(() => new ShaderPass(shader), [shader]);
        manager.addPass(unrelatedPass);
        const composer = useMemo(() => new EffectComposer(renderer), [renderer]);
        const escapedPass = useMemo(() => new ShaderPass(shader), [shader]);
        composer.addPass(escapedPass);
        manager.adopt(composer);
        return null;
      }
    `;
    expect(runThreePostprocessingRule(code).diagnostics).toHaveLength(0);
  });

  it("excludes resource-free, declarative, stdlib, and pmndrs pass cases", () => {
    const code = `
      import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
      import { ClearPass } from "three/addons/postprocessing/ClearPass.js";
      import { ShaderPass as StdlibPass } from "three-stdlib";
      import { EffectPass } from "postprocessing";
      import { EffectComposer } from "@react-three/postprocessing";
      function Scene({ camera, scene, shader }) {
        const renderPass = new RenderPass(scene, camera);
        const clearPass = new ClearPass();
        const stdlib = new StdlibPass(shader);
        const pmndrsPass = new EffectPass(camera);
        return <EffectComposer>{String(renderPass.enabled || clearPass.enabled || stdlib.enabled || pmndrsPass.enabled)}</EffectComposer>;
      }
    `;
    expect(runThreePostprocessingRule(code).diagnostics).toHaveLength(0);
  });

  it("rejects unrelated and shadowed constructors", () => {
    const code = `
      import { EffectComposer } from "composer-library";
      import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
      function Scene() {
        const ShaderPass = class LocalPass {};
        const composer = new EffectComposer();
        const pass = new ShaderPass();
        return composer.enabled || pass.enabled;
      }
    `;
    expect(runThreePostprocessingRule(code).diagnostics).toHaveLength(0);
  });

  it("rejects near-match Three postprocessing paths", () => {
    const code = `
      import { EffectComposer as WrongFolder } from "three/addons/composers/EffectComposer.js";
      import { EffectComposer as WrongExtension } from "three/addons/postprocessing/EffectComposer.mjs";
      import { ShaderPass as WrongConstructor } from "three/addons/postprocessing/CustomShaderPass.js";
      function Scene() {
        const first = new WrongFolder();
        const second = new WrongExtension();
        const third = new WrongConstructor();
        return first.enabled || second.enabled || third.enabled;
      }
    `;
    expect(runThreePostprocessingRule(code).diagnostics).toHaveLength(0);
  });

  it("uses separate release boundaries for composers and owning passes", () => {
    const code = `
      import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
      import { ShaderPass } from "three/addons/postprocessing/ShaderPass";
      import { AdaptiveToneMappingPass } from "three/examples/jsm/postprocessing/AdaptiveToneMappingPass.js";
      import { OutlinePass } from "three/addons/postprocessing/OutlinePass";
      function Scene({ renderer, shader }) {
        const composer = new EffectComposer(renderer);
        const pass = new ShaderPass(shader);
        const adaptive = new AdaptiveToneMappingPass();
        const outline = new OutlinePass();
        return composer.enabled || pass.enabled || adaptive.enabled || outline.enabled;
      }
    `;
    const release145Settings = {
      "react-doctor": { capabilities: ["three", "three:145"] },
    };
    expect(
      runRule(threeRequirePostprocessingCleanup, code, { settings: release145Settings })
        .diagnostics,
    ).toHaveLength(2);
    expect(runThreePostprocessingRule(code).diagnostics).toHaveLength(4);
  });

  it("gates Three's postprocessing barrel on release 158", () => {
    const code = `
      import { EffectComposer, ShaderPass } from "three/addons";
      function Scene({ renderer, shader }) {
        const composer = new EffectComposer(renderer);
        const pass = new ShaderPass(shader);
        return composer.enabled || pass.enabled;
      }
    `;
    const release157Settings = {
      "react-doctor": { capabilities: ["three", "three:157"] },
    };
    const release158Settings = {
      "react-doctor": { capabilities: ["three", "three:158"] },
    };
    expect(
      runRule(threeRequirePostprocessingCleanup, code, { settings: release157Settings })
        .diagnostics,
    ).toHaveLength(0);
    expect(
      runRule(threeRequirePostprocessingCleanup, code, { settings: release158Settings })
        .diagnostics,
    ).toHaveLength(2);
  });

  it("gates FXAAPass disposal on release 177", () => {
    const code = `
      import { FXAAPass as DirectPass } from "three/addons/postprocessing/FXAAPass.js";
      import { FXAAPass as BarrelPass } from "three/examples/jsm/Addons.js";
      function Scene() {
        const direct = new DirectPass();
        const barrel = new BarrelPass();
        return direct.enabled || barrel.enabled;
      }
    `;
    const release176Settings = {
      "react-doctor": { capabilities: ["three", "three:176"] },
    };
    const release177Settings = {
      "react-doctor": { capabilities: ["three", "three:177"] },
    };
    expect(
      runRule(threeRequirePostprocessingCleanup, code, { settings: release176Settings })
        .diagnostics,
    ).toHaveLength(0);
    expect(
      runRule(threeRequirePostprocessingCleanup, code, { settings: release177Settings })
        .diagnostics,
    ).toHaveLength(2);
  });

  it("uses each pass's first disposal release", () => {
    const cases = [
      ["RenderPixelatedPass", 146, 147],
      ["OutputPass", 152, 153],
      ["GTAOPass", 159, 160],
      ["RenderTransitionPass", 163, 164],
    ];
    for (const [passName, previousRelease, disposalRelease] of cases) {
      const code = `
        import { ${passName} } from "three/addons/postprocessing/${passName}.js";
        function Scene() {
          const pass = new ${passName}();
          return pass.enabled;
        }
      `;
      const previousSettings = {
        "react-doctor": { capabilities: ["three", `three:${previousRelease}`] },
      };
      const disposalSettings = {
        "react-doctor": { capabilities: ["three", `three:${disposalRelease}`] },
      };
      expect(
        runRule(threeRequirePostprocessingCleanup, code, { settings: previousSettings })
          .diagnostics,
      ).toHaveLength(0);
      expect(
        runRule(threeRequirePostprocessingCleanup, code, { settings: disposalSettings })
          .diagnostics,
      ).toHaveLength(1);
    }
  });

  it("still reports pmndrs composers without a classified Three.js release", () => {
    const code = `
      import { EffectComposer } from "postprocessing";
      function Scene({ renderer }) {
        const composer = new EffectComposer(renderer);
        return composer.enabled;
      }
    `;
    expect(runRule(threeRequirePostprocessingCleanup, code).diagnostics).toHaveLength(1);
  });
});
