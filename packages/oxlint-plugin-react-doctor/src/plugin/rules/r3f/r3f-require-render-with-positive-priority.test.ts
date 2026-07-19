import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireRenderWithPositivePriority } from "./r3f-require-render-with-positive-priority.js";

describe("r3f-require-render-with-positive-priority", () => {
  it("reports statically positive priorities without a render sink", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame as scheduleFrame } from "@react-three/fiber";
        const renderPriority = +2 as number;
        const Scene = () => {
          scheduleFrame(() => update(), 1);
          scheduleFrame(() => updateAgain(), renderPriority);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts explicit null callbacks that intentionally freeze rendering", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame } from "@react-three/fiber";
        const freezeFrame = () => null;
        const Freeze = () => {
          useFrame(() => null, 1000);
          useFrame(freezeFrame, 2);
          useFrame(() => (null as null), 3);
          useFrame(function freezeFrameWithBlock() { return null; }, 4);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports callbacks with work even when they return null", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame } from "@react-three/fiber";
        const Scene = ({ state }) => {
          useFrame(() => { state.value++; return null; }, 1);
          useFrame(() => { update(); return null; }, 2);
          useFrame(() => (update(), null), 3);
          useFrame(() => true, 4);
          useFrame(() => undefined, 5);
          useFrame(async () => null, 6);
          useFrame(() => {}, 7);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(7);
  });

  it("supports namespace calls and local callback aliases", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import * as Fiber from "@react-three/fiber";
        const Scene = () => {
          const update = () => tick();
          const updateAlias = update;
          Fiber["useFrame"](updateAlias, 1);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts sync, async, composer, ref, and delegated render sinks", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame } from "@react-three/fiber";
        const Scene = ({ composer, renderer }) => {
          useFrame(({ gl: graphics }) => {
            const renderScene = () => graphics.render(scene, camera);
            renderScene();
          }, 1);
          useFrame((state) => state.gl["render"](scene, camera), 2);
          useFrame((state) => state.gl.renderAsync(scene, camera), 3);
          useFrame(() => renderer.render(scene, camera), 4);
          useFrame(() => composer.current.render(), 5);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts locally constructed Three renderers and postprocessing composers", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useRef } from "react";
        import { useFrame } from "@react-three/fiber";
        import { WebGLRenderer as Renderer } from "three";
        import { EffectComposer } from "postprocessing";
        const threeRenderer = new Renderer();
        const Scene = () => {
          const composerRef = useRef(new EffectComposer(threeRenderer));
          useFrame(() => threeRenderer.render(scene, camera), 1);
          useFrame(() => composerRef.current.render(), 2);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts static render calls on forwarded and null-initialized receivers", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame } from "@react-three/fiber";
        import { useRef } from "react";
        const Scene = ({ renderer, composerRef }) => {
          const localComposerRef = useRef(null);
          useFrame(() => {
            renderer.render(scene, camera);
            composerRef.current.render();
            localComposerRef.current?.render();
          }, 1);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an optional computed render call on a null-initialized ref", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useRef } from "react";
        import { useFrame } from "@react-three/fiber";
        const Scene = () => {
          const composerRef = useRef(null);
          useFrame(() => composerRef.current?.["render"](), 1);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects proven template-library render calls as frame render ownership", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import Mustache from "mustache";
        import * as Handlebars from "handlebars";
        import { useFrame } from "@react-three/fiber";
        const templates = Mustache;
        const Scene = () => {
          useFrame(() => {
            templates.render(source, view);
            Handlebars.render(source, view);
          }, 1);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps unknown forwarded render receivers as conservative suppression", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame } from "@react-three/fiber";
        const Scene = ({ composerRef }) => {
          useFrame(() => composerRef.current.render(), 1);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows one positive subscription to own rendering for the component", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame } from "@react-three/fiber";
        const Scene = () => {
          useFrame(() => updatePhysics(), 1);
          useFrame(({ gl }) => gl.render(scene, camera), 2);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a render owner in another component in the same module", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame } from "@react-three/fiber";
        const Renderer = () => { useFrame(({ gl }) => gl.render(scene, camera), 2); return null; };
        const Physics = () => { useFrame(() => updatePhysics(), 1); return null; };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an imported postprocessing composer as the render owner", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame } from "@react-three/fiber";
        import { EffectComposer } from "@react-three/postprocessing";
        const Experience = () => { useFrame(() => updatePhysics(), 1); return null; };
        const Effects = () => <EffectComposer />;
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows non-positive, dynamic, and v10 scheduling values", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame } from "@react-three/fiber";
        const Scene = ({ priority }) => {
          useFrame(() => update());
          useFrame(() => update(), 0);
          useFrame(() => update(), -1);
          useFrame(() => update(), priority);
          useFrame(() => update(), { priority: 2 });
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a positive callback is imported or otherwise unresolved", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame } from "@react-three/fiber";
        import { renderFrame } from "./render-frame";
        const Scene = () => {
          useFrame(() => update(), 1);
          useFrame(renderFrame, 2);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores unrelated and shadowed useFrame functions", () => {
    const result = runRule(
      r3fRequireRenderWithPositivePriority,
      `
        import { useFrame as animationFrame } from "animation-library";
        import { useFrame } from "@react-three/fiber";
        animationFrame(() => update(), 1);
        const configure = (useFrame) => useFrame(() => update(), 1);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
