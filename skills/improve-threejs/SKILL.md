---
name: improve-threejs
description: Audit and fix Three.js and React Three Fiber apps for frame-loop performance, GPU memory leaks, scene-graph correctness, and visual defects like z-fighting, shadow acne, wrong color space, and broken resize handling. Uses React Doctor as the scanning engine plus a visual rubric checked against rendered output. Use when the user asks to improve, audit, scan, or clean up a Three.js, R3F, react-three-fiber, drei, or WebGL app, or types `/improve-threejs`.
---

# Improve Three.js

Audits a Three.js or React Three Fiber (R3F) codebase and fixes what hurts most: work that runs every frame, GPU resources that never get disposed, scene-graph objects rebuilt on every render, and visual defects the user can see. React Doctor supplies the machine-verified code scan; this skill supplies the frame-loop judgment and the visual inspection a general React scanner lacks.

The core principle: severity follows the render loop. Code inside `useFrame` or a `requestAnimationFrame` callback runs 60 times per second, so a minor inefficiency there outweighs a major one in a settings panel. Rank every finding by where it runs, not by the rule's default severity.

## Workflow

### Step 1: Recon

Identify the stack before scanning: plain Three.js or R3F, which helper libraries are in use (drei, postprocessing, rapier), and where the render loop lives (`useFrame` hooks, `requestAnimationFrame`, the `<Canvas frameloop>` setting).

Build a hot-path map: every `useFrame` body, every RAF callback, every pointer-move handler. These files get the strictest review in Step 3.

### Step 2: Scan

Run React Doctor read-only to collect structured evidence:

```bash
npx react-doctor@latest --verbose
```

For a regression check after making changes, run with `--scope changed` and confirm the score did not drop.

### Step 3: Triage by frame-loop leverage

Re-rank the scanner's findings using the hot-path map, then hunt for the Three.js-specific problems the scanner cannot see. Confirm every finding at its `file:line` before reporting it.

**HIGH severity, runs every frame or leaks GPU memory:**

- **Allocation inside `useFrame`**: `new Vector3()`, `new Color()`, or fresh arrays passed to Three.js APIs each frame. Fix: hoist a scratch object to module scope or `useMemo`, then mutate it in place
- **`setState` inside `useFrame`**: re-renders the React tree on every frame. Fix: mutate refs directly; reserve state for discrete changes like selection or visibility
- **Missing disposal**: geometries, materials, textures, or render targets created imperatively and never disposed. Fix: call `dispose()` in the cleanup function, or move the object into R3F's declarative tree so it owns the lifecycle
- **Object reconstruction in render**: geometry or material instances created without `useMemo`, or inline `args` arrays whose identity changes each render, forcing R3F to rebuild the underlying object

**MEDIUM severity, per-render or per-interaction waste:**

- **Unstable scene-graph props**: inline `new THREE.Vector3()` or fresh material objects as props (plain arrays like `position={[x, y, z]}` are fine; R3F handles them)
- **Missing instancing**: hundreds of identical meshes rendered individually instead of through `<Instances>` or `InstancedMesh`
- **Wasted frames**: `frameloop="always"` on a scene that only changes on interaction. Fix: `frameloop="demand"` plus `invalidate()`
- **Uncached asset loading**: textures and models loaded outside `useLoader`, `useTexture`, or `useGLTF`, losing caching and Suspense integration

**LOW severity, hygiene:** React Doctor findings on non-canvas UI code, missing `<Preload>`, oversized textures.

### Step 4: Visual audit

Inspect what the scene actually renders. Every visual finding needs evidence: a screenshot, a frame capture, or a reproduced observation, never a guess from reading source. When a dev server and browser are available, load the app, capture the first stable frame, then capture again after moving the camera and interacting. When no browser is available, check the code-level causes listed below and label each finding as inferred from source.

Apply the mini rubric. A row fails only when the evidence shows the failure condition:

| Area                   | Check                                                                  | Fail when                                                                                          |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Render sanity          | The scene reaches a stable frame after load                            | Black canvas, WebGL context errors, or content that never appears                                  |
| Geometry               | Move the camera along seams, edges, and boundaries                     | Gaps, missing faces, visible backfaces, or two surfaces flickering at the same depth (z-fighting)  |
| Transparency and depth | Cross depth-order boundaries with overlapping or transmissive surfaces | Wrong sort order, halos, opaque surfaces that should transmit, or flicker at grazing angles        |
| Textures               | View mapped surfaces close, far, and at grazing angles                 | Missing textures, stretching, seams, moiré, shimmer, or washed-out colors from a wrong color space |
| Materials and lighting | Change light and view direction on lit surfaces                        | Surfaces that ignore light direction, or reflective metals with no environment to reflect          |
| Shadows                | Move casters, receivers, and the light through their range             | Acne, detached or floating shadows, flicker at rest, or shadows that outlive their caster          |
| Camera                 | Follow the primary subject through movement and transitions            | Subject leaves frame, camera clips into geometry, or foreground blocks the play area               |
| Scale and contact      | Compare object scale and resting contact against surroundings          | Objects float above, sink into, or intersect their support surface, or sit at implausible scale    |
| Image stability        | Pan the camera slowly at supported resolutions                         | Silhouettes, thin geometry, or highlights that crawl, sparkle, or ghost                            |
| Resize and DPR         | Change viewport size, zoom, and device pixel ratio                     | Distortion, blur, stretched output, or content leaving the viewport                                |

Each rubric row has a small set of usual code-level causes. Check these first when a row fails:

- **Washed-out or too-dark colors**: `renderer.outputColorSpace` not set to `SRGBColorSpace`, color textures missing `texture.colorSpace = SRGBColorSpace`, or a data texture (normal, roughness) wrongly marked sRGB
- **Z-fighting**: coplanar geometry needing `polygonOffset` or a position nudge, or a near plane set far too small for the scene scale
- **Shadow acne or floating shadows**: `shadow.bias` and `shadow.normalBias` untuned, or a shadow camera frustum far larger than the scene
- **Blurry or stretched canvas**: renderer size not synced to canvas CSS size, `setPixelRatio` never called, or a resize handler that forgets `camera.updateProjectionMatrix()`
- **Black metals**: `metalness: 1` with no `scene.environment` set
- **Transparency sorting glitches**: large transparent meshes needing `depthWrite: false`, manual `renderOrder`, or a split into smaller meshes
- **Shimmer and crawl**: missing texture anisotropy, antialiasing disabled, or thin geometry needing thicker forms

### Step 5: Fix

Fix in severity order: HIGH performance findings and failed visual rows first. When a finding maps to a React Doctor rule, fetch the canonical recipe instead of improvising:

```text
https://www.react.doctor/prompts/rules/<plugin>/<rule>.md
```

For Three.js-specific findings, apply the fix named in the triage list or the cause list above.

### Step 6: Validate

Run `npx react-doctor@latest --verbose --scope changed` and confirm the score did not regress. Re-check every visual rubric row that failed, using the same viewpoint and interaction as the original evidence, and confirm it now passes. Then verify behavior: the scene renders, animations play, and interactions respond. If browser dev tools are available, watch the memory profile while orbiting an idle scene; a rising heap during idle means a disposal leak survived.

## Checks the scanner always misses

Review these by hand on every audit:

- `dispose()` coverage for every imperatively created GPU resource
- Allocations and `setState` inside `useFrame` and RAF callbacks
- Event listeners and `ResizeObserver`s on the canvas or window without cleanup
- Raycasting against the full scene on every pointer move instead of a filtered target list
- Shadows or postprocessing enabled globally when one part of the scene needs them
- Color space configuration on the renderer and every color texture
