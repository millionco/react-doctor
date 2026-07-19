import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireControlsCleanup } from "./three-require-controls-cleanup.js";

describe("three-require-controls-cleanup", () => {
  it("requires an R3F version gate", () => {
    expect(threeRequireControlsCleanup.requires).toEqual(["r3f:3"]);
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
});
