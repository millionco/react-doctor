// rule: three-shader-require-uniform-bindings
// verdict: pass
// weakness: name-heuristic
// source: PR #1455 Bugbot review

import { ShaderMaterial } from "three";

export const material = new ShaderMaterial({
  fragmentShader: `
    uniform float uUnused;
    void main() {
      gl_FragColor = vec4(1.0);
    }
  `,
});
