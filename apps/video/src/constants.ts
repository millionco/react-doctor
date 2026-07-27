export interface ScannedIssue {
  file: string;
  message: string;
  pointsLost: number;
  severity: "error" | "warning";
}

export const VIDEO_WIDTH_PX = 1920;
export const VIDEO_HEIGHT_PX = 1080;
export const VIDEO_FPS = 30;
export const BACKGROUND_COLOR = "#0a0a0a";
export const TEXT_COLOR = "#d4d4d8";
export const MUTED_COLOR = "#737373";
export const RED_COLOR = "#f87171";
export const GREEN_COLOR = "#4ade80";
export const YELLOW_COLOR = "#eab308";
export const WHITE_COLOR = "#ffffff";
export const EMPTY_BAR_COLOR = "#525252";
export const CLAUDE_COLOR = "#d97757";
export const FONT_FAMILY = '"IBM Plex Mono", monospace';
export const ERROR_ROW_BACKGROUND_COLOR = "rgba(127, 29, 29, 0.28)";
export const ERROR_BADGE_BACKGROUND_COLOR = "#dc2626";
export const ERROR_BADGE_TEXT_COLOR = "#fafafa";
export const WARNING_BADGE_BACKGROUND_COLOR = "#a16207";
export const DIVIDER_COLOR = "rgba(255,255,255,0.15)";
export const FILE_ROW_HORIZONTAL_PADDING_PX = 24;
export const FILE_ROW_VERTICAL_PADDING_PX = 4;
export const FILE_ROW_GAP_PX = 24;
export const SEVERITY_BADGE_SIZE_PX = 44;
export const SEVERITY_BADGE_RADIUS_PX = 6;
export const SCORE_GOOD_THRESHOLD = 75;
export const SCORE_OK_THRESHOLD = 50;
export const TARGET_SCORE = 42;
export const PERFECT_SCORE = 100;
export const COMMAND = "npx react-doctor@latest";
export const REACT_DOCTOR_URL = "https://react.doctor";
export const CURSOR_BLINK_DURATION_FRAMES = 16;

export const DIAGNOSE_COMMAND = "/react-doctor fix my code";
export const DIAGNOSE_COMMAND_PREFIX = "/react-doctor";
export const DIAGNOSE_CHAR_DURATION_FRAMES = 2;
export const DIAGNOSE_TYPING_DELAY_FRAMES = 8;
export const DIAGNOSE_TYPING_POST_PAUSE_FRAMES = 8;
export const DIAGNOSE_ZOOM_SCALE = 1.8;
export const DIAGNOSE_ZOOM_OUT_DURATION_FRAMES = 28;
export const DIAGNOSE_SCAN_LEAD_FRAMES = 4;
export const DIAGNOSE_SCAN_FRAMES_PER_ISSUE = 5;
export const DIAGNOSE_VERDICT_DELAY_FRAMES = 5;
export const DIAGNOSE_VERDICT_HOLD_FRAMES = 45;
export const DIAGNOSE_VERDICT_ZOOM_SCALE = 1.3;
export const DIAGNOSE_VERDICT_ZOOM_DURATION_FRAMES = 20;
export const DIAGNOSE_FIX_INTERVAL_FRAMES = 5;
export const DIAGNOSE_FIX_FADE_DURATION_FRAMES = 3;
export const DIAGNOSE_DONE_FADE_DURATION_FRAMES = 8;
export const DIAGNOSE_SCORE_FADE_DURATION_FRAMES = 8;
export const DIAGNOSE_SCORE_ANIMATION_DURATION_FRAMES = 15;
export const DIAGNOSE_HORIZONTAL_PADDING_PX = 80;
export const DIAGNOSE_TOP_PADDING_PX = 60;
export const DIAGNOSE_PROMPT_TOP_PX = 280;
export const DIAGNOSE_STATUS_TOP_PX = 380;
export const DIAGNOSE_ITEMS_TOP_PX = 460;
export const DIAGNOSE_BADGE_TOP_PX = 840;
export const DIAGNOSE_BADGE_LEFT_PX = 80;
export const DIAGNOSE_BADGE_NUMBER_FONT_SIZE_PX = 64;
export const DIAGNOSE_BADGE_LABEL_FONT_SIZE_PX = 40;
export const DIAGNOSE_BADGE_BAR_HEIGHT_PX = 32;
export const DIAGNOSE_BADGE_BAR_WIDTH_PX = 900;
export const DIAGNOSE_LOGO_SIZE_PX = 160;
export const DIAGNOSE_LOGO_FONT_SIZE_PX = 32;
export const DIAGNOSE_ZOOMED_PROMPT_FONT_SIZE_PX = 56;
export const DIAGNOSE_PROMPT_FONT_SIZE_PX = 44;
export const DIAGNOSE_ITEM_FONT_SIZE_PX = 34;
export const DIAGNOSE_ITEM_LINE_HEIGHT = 1.6;
export const DIAGNOSE_STATUS_FONT_SIZE_PX = 44;
export const DIAGNOSE_VERDICT_FONT_SIZE_PX = 48;
export const DIAGNOSE_LIST_INITIAL_HEIGHT_PX = 500;
export const DIAGNOSE_LIST_VERDICT_HEIGHT_PX = 350;
export const DIAGNOSE_LIST_FADE_HEIGHT_PX = 60;
export const DIAGNOSE_LIST_VERTICAL_PADDING_PX = 12;
export const DIAGNOSE_SPINNER_DURATION_FRAMES = 3;
export const DIAGNOSE_FIXED_STYLE_PROGRESS = 0.3;
export const SPINNER_CHARACTERS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const FINAL_SCORE_ANIMATION_DURATION_FRAMES = 50;
export const FINAL_SCORE_FONT_SIZE_PX = 96;
export const FINAL_SCORE_FACE_SIZE_PX = 252;
export const FINAL_SCORE_LABEL_FONT_SIZE_PX = 56;
export const FINAL_SCORE_BAR_HEIGHT_PX = 66;
export const FINAL_SCORE_BAR_WIDTH_PX = 1000;
export const FINAL_SCORE_URL_FONT_SIZE_PX = 52;
export const FINAL_SCORE_GAP_PX = 48;
export const CONFETTI_COUNT = 500;
export const CONFETTI_WAVE_COUNT = 4;
export const CONFETTI_WAVE_DELAY_FRAMES = 5;
export const CONFETTI_COLORS = [
  GREEN_COLOR,
  YELLOW_COLOR,
  "#60a5fa",
  "#c084fc",
  "#fb923c",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#818cf8",
];

export const TERMINAL_TYPING_FONT_SIZE_PX = 100;
export const TERMINAL_TYPING_DELAY_FRAMES = 10;
export const TERMINAL_TYPING_CHAR_DURATION_FRAMES = 1;
export const TERMINAL_CONTENT_LEFT_PADDING_PX = 160;
export const TERMINAL_CONTENT_RIGHT_PADDING_PX = 80;

export const DIAGNOSE_SCENE_DURATION_FRAMES = 310;
export const SCORE_SCENE_DURATION_FRAMES = 110;
export const TERMINAL_SCENE_DURATION_FRAMES = 45;
export const SCORE_SCENE_START_FRAME = DIAGNOSE_SCENE_DURATION_FRAMES;
export const TERMINAL_SCENE_START_FRAME = SCORE_SCENE_START_FRAME + SCORE_SCENE_DURATION_FRAMES;
export const TOTAL_DURATION_FRAMES = TERMINAL_SCENE_START_FRAME + TERMINAL_SCENE_DURATION_FRAMES;

export const DIAGNOSTICS: ScannedIssue[] = [
  { message: "Array index used as key", severity: "error", pointsLost: 5, file: "UserList.tsx:14" },
  {
    message: "Component defined inside component",
    severity: "error",
    pointsLost: 5,
    file: "Dashboard.tsx:87",
  },
  { message: "Derived state in useEffect", severity: "error", pointsLost: 5, file: "Cart.tsx:23" },
  {
    message: "Missing cleanup in useEffect",
    severity: "error",
    pointsLost: 5,
    file: "Chat.tsx:41",
  },
  {
    message: "setState in useEffect without deps",
    severity: "error",
    pointsLost: 5,
    file: "Feed.tsx:19",
  },
  {
    message: "New object created every render",
    severity: "warning",
    pointsLost: 2,
    file: "Theme.tsx:8",
  },
  { message: "Inline function as prop", severity: "warning", pointsLost: 2, file: "Button.tsx:32" },
  { message: "useState synced from prop", severity: "error", pointsLost: 5, file: "Modal.tsx:11" },
  {
    message: "Unnecessary re-render detected",
    severity: "warning",
    pointsLost: 2,
    file: "Sidebar.tsx:55",
  },
  { message: "Missing error boundary", severity: "warning", pointsLost: 2, file: "App.tsx:1" },
  {
    message: "Large component (300+ lines)",
    severity: "warning",
    pointsLost: 2,
    file: "Settings.tsx:1",
  },
  {
    message: "Direct DOM mutation in component",
    severity: "error",
    pointsLost: 5,
    file: "Canvas.tsx:67",
  },
  {
    message: "Fetch in useEffect without race guard",
    severity: "error",
    pointsLost: 5,
    file: "Profile.tsx:29",
  },
  {
    message: "Context provider re-renders all consumers",
    severity: "warning",
    pointsLost: 2,
    file: "AuthProvider.tsx:18",
  },
  {
    message: "Stale closure in event handler",
    severity: "error",
    pointsLost: 5,
    file: "Editor.tsx:104",
  },
];
