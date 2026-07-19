import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireProjectionMatrixUpdate } from "./r3f-require-projection-matrix-update.js";

describe("r3f-require-projection-matrix-update", () => {
  it("supports every detected Fiber version", () => {
    expect(r3fRequireProjectionMatrixUpdate.requires).toBeUndefined();
  });

  it("reports perspective projection writes on cameras selected with useThree", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useThree } from "@react-three/fiber";
       const Scene = ({ aspect }) => {
         const camera = useThree((state) => state.camera);
         const resize = () => {
           camera.fov = 45;
           camera["aspect"] = aspect;
         };
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports cameras read from the whole useThree state", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useThree } from "@react-three/fiber";
       const Scene = () => {
         const rootState = useThree();
         const { camera } = useThree();
         const resize = () => {
           rootState.camera.aspect = 2;
           camera.fov = 45;
         };
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not claim mixed useThree selector results are always managed cameras", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useThree } from "@react-three/fiber";
       const Scene = ({ chooseExternal, externalCamera }) => {
         const camera = useThree((state) => chooseExternal ? externalCamera : state.camera);
         camera.fov = 45;
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports orthographic projection writes through useFrame state", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import * as Fiber from "@react-three/fiber";
       Fiber.useFrame((state) => {
         state.camera.left = -state.viewport.width;
         state.camera.right = state.viewport.width;
         state.camera.zoom++;
       });`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports destructured and safely aliased frame cameras", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame as scheduleFrame } from "@react-three/fiber/native";
       scheduleFrame(({ camera }) => {
         const activeCamera = camera;
         activeCamera.near = 0.1;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports React refs bound to R3F perspective and orthographic cameras", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useRef } from "react";
       import { Canvas } from "@react-three/fiber";
       const Cameras = () => {
         const perspectiveRef = useRef(null);
         const orthographicRef = useRef(null);
         const resize = () => {
           perspectiveRef.current.aspect = 2;
           orthographicRef.current.top = 3;
         };
         return <Canvas><perspectiveCamera ref={perspectiveRef} /><orthographicCamera ref={orthographicRef} /></Canvas>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts a later direct refresh for the same camera", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useThree } from "@react-three/fiber";
       const Scene = () => {
         const camera = useThree(({ camera }) => camera);
         const resize = () => {
           camera.aspect = 2;
           camera.zoom += 0.5;
           camera.updateProjectionMatrix();
         };
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a direct local wrapper that refreshes the same camera", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useThree } from "@react-three/fiber";
       const Scene = () => {
         const camera = useThree((state) => state.camera);
         const refresh = () => camera.updateProjectionMatrix();
         const resize = () => {
           camera.fov = 45;
           refresh();
         };
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts static computed refresh calls and transparent wrappers", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame((state) => {
         (state.camera as Camera).far = 500;
         (state.camera as Camera)["updateProjectionMatrix"]();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires the refresh on every path after an unconditional write", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         camera.aspect = 2;
         if (shouldRefresh) camera.updateProjectionMatrix();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a short-circuited refresh as unconditional", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         camera.aspect = 2;
         shouldRefresh && camera.updateProjectionMatrix();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a refresh guarded by a comparison with the previous projection value", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         const previousZoom = camera.zoom;
         camera.zoom = nextZoom;
         if (camera.zoom !== previousZoom) camera.updateProjectionMatrix();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects imprecise previous-value refresh guards", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         const previousAspect = camera.aspect;
         camera.zoom = nextZoom;
         if (camera.zoom !== previousAspect) camera.updateProjectionMatrix();
       });
       useFrame(({ camera }) => {
         const previousZoom = camera.zoom;
         camera.zoom = nextZoom;
         if (camera.zoom === previousZoom) camera.updateProjectionMatrix();
       });
       useFrame(({ camera }) => {
         let previousZoom = camera.zoom;
         camera.zoom = nextZoom;
         if (camera.zoom !== previousZoom) camera.updateProjectionMatrix();
       });
       useFrame(({ camera }) => {
         const previousZoom = camera.zoom;
         camera.zoom = nextZoom;
         console.log("zoom changed");
         if (camera.zoom !== previousZoom) camera.updateProjectionMatrix();
       });`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("accepts a refresh that shares the write's short-circuit guard", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         shouldResize && (camera.aspect = 2, camera.updateProjectionMatrix());
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts refreshes that cover both branches", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         camera.zoom = 2;
         if (isWide) camera.updateProjectionMatrix();
         else camera["updateProjectionMatrix"]();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts refreshes that cover both conditional-expression branches", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         camera.zoom = 2;
         isWide ? camera.updateProjectionMatrix() : camera["updateProjectionMatrix"]();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a shared refresh after a conditional write", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         if (isWide) camera.aspect = 2;
         camera.updateProjectionMatrix();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a conditional write that returns before the shared refresh", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         if (shouldStop) {
           camera.near = 0.5;
           return;
         }
         camera.updateProjectionMatrix();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not require a refresh on a throwing path", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         camera.near = 0.5;
         if (invalid) throw new Error("invalid camera");
         camera.updateProjectionMatrix();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let an earlier refresh satisfy a later write", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         camera.updateProjectionMatrix();
         camera.far = 1000;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps declarative props and non-projection writes quiet", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { Canvas } from "@react-three/fiber";
       const Scene = ({ camera }) => <Canvas camera={{ fov: 45, near: 0.1 }}><perspectiveCamera fov={50} zoom={2} /><mesh /></Canvas>;
       camera.position.x = 1;
       camera.rotation.y = 2;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps unknown Three cameras and unbound ref-shaped values quiet", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import "@react-three/fiber";
       import { PerspectiveCamera } from "three";
       const externalCamera = new PerspectiveCamera();
       externalCamera.fov = 40;
       const record = { current: externalCamera };
       record.current.aspect = 2;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps refs bound to non-camera hosts and DOM elements quiet", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useRef } from "react";
       import { Canvas } from "@react-three/fiber";
       const Scene = () => {
         const meshRef = useRef(null);
         const divRef = useRef(null);
         const update = () => {
           meshRef.current.zoom = 2;
           divRef.current.far = 3;
         };
         return <><Canvas><mesh ref={meshRef} /></Canvas><div ref={divRef} /></>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips mutable aliases and reassigned frame parameters", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame, useThree } from "@react-three/fiber";
       const selected = useThree((state) => state.camera);
       let cameraAlias = selected;
       cameraAlias.zoom = 2;
       useFrame(({ camera }) => {
         camera = getOtherCamera();
         camera.aspect = 2;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips opaque helpers that may refresh the same camera", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       import { frameCorners } from "three/addons/utils/CameraUtils.js";
       useFrame(({ camera }) => {
         camera.fov = 35;
         frameCorners(camera, bottomLeft, bottomRight, topLeft, true);
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires opaque camera helpers to run on every path", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       import { refreshCamera } from "./refresh-camera";
       useFrame(({ camera }) => {
         camera.fov = 35;
         if (debug) refreshCamera(camera);
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat known non-refreshing calls as opaque camera refreshes", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         camera.fov = 35;
         console.log(camera);
         camera.aspect = 2;
         camera.lookAt(target);
       });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("covers film properties and static computed receiver paths", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useThree } from "@react-three/fiber";
       const Scene = () => {
         const state = useThree();
         state["camera"].filmOffset = 1;
         state["camera"].filmGauge = 70;
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not accept an update for a different proven camera", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import { useRef } from "react";
       import "@react-three/fiber";
       const Scene = () => {
         const firstCamera = useRef(null);
         const secondCamera = useRef(null);
         const update = () => {
           firstCamera.current.aspect = 2;
           secondCamera.current.updateProjectionMatrix();
         };
         return <><perspectiveCamera ref={firstCamera} /><orthographicCamera ref={secondCamera} /></>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores shadowed R3F APIs and requires an R3F runtime import", () => {
    const result = runRule(
      r3fRequireProjectionMatrixUpdate,
      `import type { RootState } from "@react-three/fiber";
       const Scene = ({ useThree }) => {
         const camera = useThree((state) => state.camera);
         camera.fov = 30;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
