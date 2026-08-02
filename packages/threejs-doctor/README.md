# Three.js Doctor

Focused React Doctor diagnostics for Three.js and React Three Fiber.

```bash
npx threejs-doctor@latest
```

Three.js Doctor runs every rule tagged `three` or `r3f`, including animation-loop allocations, GPU resource cleanup, shaders, uniforms, render targets, frame deltas, pointer events, React Three Fiber lifecycle, and WebGPU migration checks. It works with vanilla Three.js projects as well as React Three Fiber, uses React Doctor's engine, respects `doctor.config.*` and inline disables, and supports the same project, diff-scope, staged, verbose, blocking, and JSON flags.

Dead-code, supply-chain, custom-plugin, external lint-config, and health-score passes are intentionally excluded from this focused audit.
