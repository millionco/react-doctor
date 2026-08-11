// rule: three-require-transparent-for-opacity
// weakness: library-idiom
// source: Three.js ShadowMaterial defaults

import { ShadowMaterial } from "three";

export const shadowMaterial = new ShadowMaterial({ opacity: 0.2 });
