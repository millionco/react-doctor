import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireControlsCleanup } from "./three-require-controls-cleanup.js";

describe("three-require-controls-cleanup", () => {
  it("does not require R3F for plain React and Three.js projects", () => {
    expect(threeRequireControlsCleanup.requires).toBeUndefined();
  });

  it("reports component-owned controls from supported Three.js modules", () => {
    const code = `
      import { useMemo } from "react";
      import { OrbitControls as Orbit } from "three/addons/controls/OrbitControls.js";
      import * as Controls from "three/examples/jsm/controls/TransformControls.js";
      import { MapControls } from "three-stdlib";
      const Scene = ({ camera, element }) => {
        const orbit = useMemo(() => new Orbit(camera, element), [camera, element]);
        const transform = useMemo(
          () => new Controls.TransformControls(camera, element),
          [camera, element],
        );
        const map = new MapControls(camera, element);
        return <><primitive object={orbit} /><primitive object={transform} /><primitive object={map} /></>;
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(3);
  });

  it("accepts matching effect cleanup for stable and reactive controls", () => {
    const code = `
      import React, { useEffect, useMemo, useState } from "react";
      import { OrbitControls } from "three/addons/controls/OrbitControls.js";
      import { TransformControls } from "three-stdlib";
      const Scene = ({ camera, element }) => {
        const orbit = useMemo(() => new OrbitControls(camera, element), [camera, element]);
        const [transform] = useState(() => new TransformControls(camera, element));
        useEffect(() => () => orbit.dispose(), [orbit]);
        React.useLayoutEffect(() => () => transform.dispose(), []);
        return <><primitive object={orbit} /><primitive object={transform} /></>;
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(0);
  });

  it("accepts disconnect when disposal only disconnects listeners", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { DragControls } from "three/addons/controls/DragControls.js";
      import { FirstPersonControls } from "three/addons/controls/FirstPersonControls.js";
      import { FlyControls } from "three/addons/controls/FlyControls.js";
      import { MapControls } from "three/addons/controls/MapControls.js";
      import { OrbitControls } from "three/addons/controls/OrbitControls.js";
      import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
      import { TrackballControls } from "three/addons/controls/TrackballControls.js";
      const Scene = ({ camera, element, objects }) => {
        const drag = useMemo(() => new DragControls(objects, camera, element), [camera, element, objects]);
        const firstPerson = useMemo(() => new FirstPersonControls(camera, element), [camera, element]);
        const fly = useMemo(() => new FlyControls(camera, element), [camera, element]);
        const map = useMemo(() => new MapControls(camera, element), [camera, element]);
        const orbit = useMemo(() => new OrbitControls(camera, element), [camera, element]);
        const pointerLock = useMemo(() => new PointerLockControls(camera, element), [camera, element]);
        const trackball = useMemo(() => new TrackballControls(camera, element), [camera, element]);
        useEffect(() => () => {
          drag.disconnect();
          firstPerson.disconnect();
          fly.disconnect();
          map.disconnect();
          orbit.disconnect();
          pointerLock.disconnect();
          trackball.disconnect();
        }, [drag, firstPerson, fly, map, orbit, pointerLock, trackball]);
        return null;
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(0);
  });

  it("accepts a conditional connection paired with the same effect cleanup", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
      const Scene = ({ camera, enabled }) => {
        const controls = useMemo(() => new PointerLockControls(camera), [camera]);
        useEffect(() => {
          if (enabled) {
            controls.connect();
            return () => controls.disconnect();
          }
        }, [controls, enabled]);
        return null;
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(0);
  });

  it("rejects a conditional connection with a cleanup gap", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
      const Scene = ({ camera, enabled, shouldDisconnect }) => {
        const controls = useMemo(() => new PointerLockControls(camera), [camera]);
        useEffect(() => {
          if (enabled) {
            controls.connect();
            if (shouldDisconnect) return () => controls.disconnect();
          }
        }, [controls, enabled, shouldDisconnect]);
        return null;
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(1);
  });

  it("tracks useRef-owned controls and accepts cleanup through current", () => {
    const code = `
      import { useEffect, useRef } from "react";
      import { OrbitControls } from "three/addons/controls/OrbitControls.js";
      const Missing = ({ camera, element }) => {
        const controlsRef = useRef(new OrbitControls(camera, element));
        return <primitive object={controlsRef.current} />;
      };
      const Complete = ({ camera, element }) => {
        const controlsRef = useRef(null);
        if (!controlsRef.current) {
          controlsRef.current = new OrbitControls(camera, element);
        }
        useEffect(() => () => controlsRef.current.disconnect(), []);
        return <primitive object={controlsRef.current} />;
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(1);
  });

  it("requires cleanup dependencies to follow reactive controls", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { OrbitControls } from "three/addons/controls/OrbitControls.js";
      const Scene = ({ camera, element }) => {
        const controls = useMemo(() => new OrbitControls(camera, element), [camera, element]);
        useEffect(() => () => controls.dispose(), []);
        return <primitive object={controls} />;
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(1);
  });

  it("accepts effect-owned controls disposed by the returned cleanup", () => {
    const code = `
      import { useEffect } from "react";
      import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
      const Scene = ({ camera, element }) => {
        useEffect(() => {
          const controls = new TrackballControls(camera, element);
          return () => controls.dispose();
        }, [camera, element]);
        return null;
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(0);
  });

  it("stays quiet when ownership or cleanup scheduling is unknown", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { OrbitControls } from "three/addons/controls/OrbitControls.js";
      const useControls = ({ camera, element, manager, dependencies }) => {
        const adopted = useMemo(() => new OrbitControls(camera, element), [camera, element]);
        const uncertain = useMemo(() => new OrbitControls(camera, element), [camera, element]);
        manager.adopt(adopted);
        useEffect(() => () => uncertain.dispose(), dependencies);
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(0);
  });

  it("ignores declarative controls, unrelated modules, module ownership, and event allocations", () => {
    const code = `
      import { OrbitControls as DreiOrbitControls } from "@react-three/drei";
      import { OrbitControls as OtherOrbitControls } from "controls-library";
      import { OrbitControls } from "three/addons/controls/OrbitControls.js";
      const sharedControls = new OrbitControls(camera, element);
      const Scene = () => {
        const onClick = () => new OrbitControls(camera, element);
        const unrelated = new OtherOrbitControls(camera, element);
        return <><DreiOrbitControls /><button onClick={onClick}>{String(unrelated)}</button></>;
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(0);
  });

  it("ignores shadowed constructors", () => {
    const code = `
      import { OrbitControls } from "three/addons/controls/OrbitControls.js";
      const Scene = () => {
        const OrbitControls = class LocalControls {};
        const controls = new OrbitControls();
        return String(controls);
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(0);
  });

  it("requires full disposal for controls with owned helper resources", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { TransformControls } from "three/addons/controls/TransformControls.js";
      const Missing = ({ camera, element }) => {
        const controls = useMemo(() => new TransformControls(camera, element), [camera, element]);
        useEffect(() => () => controls.disconnect(), [controls]);
        return null;
      };
      const Complete = ({ camera, element }) => {
        const controls = useMemo(() => new TransformControls(camera, element), [camera, element]);
        useEffect(() => () => controls.dispose(), [controls]);
        return null;
      };
    `;
    expect(runRule(threeRequireControlsCleanup, code).diagnostics).toHaveLength(1);
  });
});
