export interface ThreeFinding {
  detail: string;
  file: string;
  title: string;
}

export interface ThreeCodeLine {
  id: string;
  text: string;
}

export const THREE_INTRO_END_FRAME = 78;
export const THREE_PROBLEM_END_FRAME = 190;
export const THREE_SCAN_END_FRAME = 300;
export const THREE_TOTAL_DURATION_FRAMES = 390;
export const THREE_TRANSITION_DURATION_FRAMES = 18;
export const THREE_FINDING_INTERVAL_FRAMES = 13;
export const THREE_FINDING_FADE_DURATION_FRAMES = 8;
export const THREE_FIX_INTERVAL_FRAMES = 9;
export const THREE_DONUT_RADIUS = 1.52;
export const THREE_DONUT_TUBE_RADIUS = 0.48;
export const THREE_DONUT_RADIAL_SEGMENTS = 48;
export const THREE_DONUT_TUBULAR_SEGMENTS = 144;
export const THREE_CAMERA_Z = 6.6;
export const THREE_CAMERA_FOV_DEGREES = 34;
export const THREE_BAD_FRAME_STEP = 3;
export const THREE_TARGET_FPS = 60;
export const THREE_BAD_FPS = 24;
export const THREE_INITIAL_ALLOCATIONS_PER_SECOND = 60;
export const THREE_GRAPH_BAR_HEIGHT_PX = 74;
export const THREE_PROBLEM_REVEAL_FRAME = 118;

export const THREE_FINDINGS: ThreeFinding[] = [
  {
    title: "Allocation inside useFrame",
    detail: "Reuse vectors instead of allocating every frame",
    file: "Donut.tsx:18",
  },
  {
    title: "Unbounded device pixel ratio",
    detail: "Cap DPR before dense displays multiply the work",
    file: "Scene.tsx:9",
  },
  {
    title: "Repeated meshes use separate draw calls",
    detail: "Batch shared geometry with instancedMesh",
    file: "Sprinkles.tsx:31",
  },
  {
    title: "Frame update ignores delta",
    detail: "Make motion independent of refresh rate",
    file: "Donut.tsx:17",
  },
];

export const THREE_GRAPH_BAR_IDS = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
];

export const THREE_BAD_CODE_LINES: ThreeCodeLine[] = [
  { id: "bad-frame-start", text: "useFrame(() => {" },
  { id: "bad-frame-allocation", text: "  const target = new THREE.Vector3()" },
  { id: "bad-frame-lerp", text: "  mesh.current.position.lerp(target, 0.1)" },
  { id: "bad-frame-rotation", text: "  mesh.current.rotation.y += 0.02" },
  { id: "bad-frame-end", text: "})" },
];

export const THREE_GOOD_CODE_LINES: ThreeCodeLine[] = [
  { id: "good-stable-target", text: "const target = useMemo(() => new THREE.Vector3(), [])" },
  { id: "good-spacer", text: "" },
  { id: "good-frame-start", text: "useFrame((_, delta) => {" },
  { id: "good-frame-lerp", text: "  mesh.current.position.lerp(target, delta * 6)" },
  { id: "good-frame-rotation", text: "  mesh.current.rotation.y += delta" },
  { id: "good-frame-end", text: "})" },
];
