export interface ThreeFinding {
  detail: string;
  file: string;
  title: string;
}

export interface ThreeCodeLine {
  id: string;
  text: string;
}

export interface ThreeClaudeFix {
  note: string;
  path: string;
}

export const THREE_INTRO_END_FRAME = 78;
export const THREE_PROBLEM_END_FRAME = 190;
export const THREE_SCAN_END_FRAME = 300;
export const THREE_CLAUDE_END_FRAME = 436;
export const THREE_TOTAL_DURATION_FRAMES = 526;
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

export const THREE_CLAUDE_ACCENT_COLOR = "#d77757";
export const THREE_CLAUDE_BACKGROUND_COLOR = "#010409";
export const THREE_CLAUDE_TEXT_COLOR = "#c9d1d9";
export const THREE_CLAUDE_MUTED_COLOR = "#6e7681";
export const THREE_CLAUDE_FONT_SIZE_PX = 36;
export const THREE_CLAUDE_PROMPT = "/improve-threejs";
export const THREE_CLAUDE_LOGO_LINE_1 = " \u2590\u259b\u2588\u2588\u2588\u259c\u258c";
export const THREE_CLAUDE_LOGO_LINE_2 = "\u259d\u259c\u2588\u2588\u2588\u2588\u2588\u259b\u2598";
export const THREE_CLAUDE_LOGO_LINE_3 = "  \u2598\u2598 \u259d\u259d";
export const THREE_CLAUDE_INTRO_FRAMES = 10;
export const THREE_CLAUDE_TYPING_START_FRAME = 12;
export const THREE_CLAUDE_TYPING_CHAR_FRAMES = 2;
export const THREE_CLAUDE_FIX_START_FRAME = 54;
export const THREE_CLAUDE_FIX_STAGGER_FRAMES = 3;
export const THREE_CLAUDE_FIX_FADE_FRAMES = 4;
export const THREE_CLAUDE_FIX_ROW_HEIGHT_PX = 58;
export const THREE_CLAUDE_VISIBLE_FIX_ROWS = 7;
export const THREE_CLAUDE_SCORE_START = 42;
export const THREE_CLAUDE_SCORE_END = 93;

export const THREE_CLAUDE_FIXES: ThreeClaudeFix[] = [
  { path: "Donut.tsx", note: "vector hoisted out of useFrame" },
  { path: "Donut.tsx", note: "motion scaled by delta" },
  { path: "Sprinkles.tsx", note: "2,000 meshes merged into one instancedMesh" },
  { path: "Scene.tsx", note: "device pixel ratio capped" },
  { path: "Scene.tsx", note: "frameloop set to demand" },
  { path: "Glaze.tsx", note: "material memoized, no rebuild per render" },
  { path: "Confetti.tsx", note: "geometry disposed on unmount" },
  { path: "textures.ts", note: "color textures marked sRGB" },
  { path: "Lights.tsx", note: "shadow bias tuned, acne gone" },
  { path: "Camera.tsx", note: "resize updates projection matrix" },
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
