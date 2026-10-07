import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidFogParameters } from "./three-valid-fog-parameters.js";

describe("three-valid-fog-parameters", () => {
  it.each([
    'import { Fog } from "three"; new Fog("white", -1, 10);',
    'import * as THREE from "three"; new THREE.Fog(0xffffff, 10, 10);',
    'import { Fog } from "three"; new Fog(0xffffff, 20, 10);',
    'import { FogExp2 } from "three"; new FogExp2("white", -0.1);',
  ])("reports invalid fog ranges", (code) => {
    expect(runRule(threeValidFogParameters, code).diagnostics).toHaveLength(1);
  });

  it.each([
    'import { Fog } from "three"; new Fog("white", 0, 100);',
    'import { FogExp2 } from "three"; new FogExp2("white", 0.1);',
    'import { Fog } from "other"; new Fog("white", -1, 0);',
    'import { Fog } from "three"; new Fog("white", near, far);',
  ])("allows valid, dynamic, and unrelated fog", (code) => {
    expect(runRule(threeValidFogParameters, code).diagnostics).toHaveLength(0);
  });
});
