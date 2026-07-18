---
"oxlint-plugin-react-doctor": patch
---

Add import-aware React Three Fiber rules for frame-loop allocation, timing and interpolation, React state updates, unstable constructor props, primitive ownership, selector stability, async callbacks, private package imports, invalid frame scheduling arguments, unstable portal containers, nullish loader inputs, inline GPU resources, unreleased global render-loop effects, synchronous readback, pointer capture, and WebGPU state, Canvas, TSL-uniform, and render-pipeline mistakes. Recognize the public root, native, legacy, WebGPU, and deprecated package entry points, including frame callbacks stabilized with React's `useCallback`, while preserving symbol-proven mutually exclusive primitive mounts, detecting co-mounted resources returned by inline render helpers, pruning statically safe logical loader fallbacks, and rejecting nested returns as render-loop cleanup.
