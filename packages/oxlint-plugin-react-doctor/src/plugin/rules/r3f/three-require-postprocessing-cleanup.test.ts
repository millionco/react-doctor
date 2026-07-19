import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequirePostprocessingCleanup } from "./three-require-postprocessing-cleanup.js";

describe("three-require-postprocessing-cleanup", () => {
  it("does not require R3F for plain React and Three.js projects", () => {
    expect(threeRequirePostprocessingCleanup.requires).toBeUndefined();
  });

  it("reports modern Three and pmndrs composers without cleanup", () => {
    const code = `
      import { useMemo } from "react";
      import { EffectComposer as ThreeComposer } from "three/addons/postprocessing/EffectComposer.js";
      import { EffectComposer as PmndrsComposer } from "postprocessing";
      function Scene({ renderer }) {
        const first = useMemo(() => new ThreeComposer(renderer), [renderer]);
        const second = useMemo(() => new PmndrsComposer(renderer), [renderer]);
        first.render();
        second.render();
        return null;
      }
    `;
    expect(runRule(threeRequirePostprocessingCleanup, code).diagnostics).toHaveLength(2);
  });

  it("reports exact resource-owning addon passes", () => {
    const code = `
      import { useMemo } from "react";
      import { ShaderPass as Shader } from "three/addons/postprocessing/ShaderPass.js";
      import * as Bloom from "three/addons/postprocessing/UnrealBloomPass.js";
      import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
      function Scene({ shader }) {
        const first = useMemo(() => new Shader(shader), [shader]);
        const second = useMemo(() => new Bloom.UnrealBloomPass(), []);
        const third = useMemo(() => new OutputPass(), []);
        return first.enabled || second.enabled || third.enabled;
      }
    `;
    expect(runRule(threeRequirePostprocessingCleanup, code).diagnostics).toHaveLength(3);
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
    expect(runRule(threeRequirePostprocessingCleanup, code).diagnostics).toHaveLength(2);
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
    expect(runRule(threeRequirePostprocessingCleanup, code).diagnostics).toHaveLength(1);
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
    expect(runRule(threeRequirePostprocessingCleanup, code).diagnostics).toHaveLength(2);
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
    expect(runRule(threeRequirePostprocessingCleanup, code).diagnostics).toHaveLength(0);
  });

  it("excludes resource-free, declarative, legacy, stdlib, and pmndrs pass cases", () => {
    const code = `
      import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
      import { ClearPass } from "three/addons/postprocessing/ClearPass.js";
      import { ShaderPass as LegacyPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
      import { ShaderPass as StdlibPass } from "three-stdlib";
      import { EffectPass } from "postprocessing";
      import { EffectComposer } from "@react-three/postprocessing";
      function Scene({ camera, scene, shader }) {
        const renderPass = new RenderPass(scene, camera);
        const clearPass = new ClearPass();
        const legacy = new LegacyPass(shader);
        const stdlib = new StdlibPass(shader);
        const pmndrsPass = new EffectPass(camera);
        return <EffectComposer>{String(renderPass.enabled || clearPass.enabled || legacy.enabled || stdlib.enabled || pmndrsPass.enabled)}</EffectComposer>;
      }
    `;
    expect(runRule(threeRequirePostprocessingCleanup, code).diagnostics).toHaveLength(0);
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
    expect(runRule(threeRequirePostprocessingCleanup, code).diagnostics).toHaveLength(0);
  });
});
