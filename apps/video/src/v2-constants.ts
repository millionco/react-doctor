export interface V2ScannedIssue {
  file: string;
  message: string;
  pointsLost: number;
  severity: "error" | "ok" | "warning";
}

export const V2_COMMAND = "npx react-doctor@latest";
export const V2_TYPING_DURATION_FRAMES = 70;
export const V2_FILE_SCAN_DURATION_FRAMES = 80;
export const V2_DIAGNOSE_DURATION_FRAMES = 175;
export const V2_SCORE_DURATION_FRAMES = 110;
export const V2_TRANSITION_DURATION_FRAMES = 15;
export const V2_CROSSFADE_IN_START_PROGRESS = 0.45;
export const V2_CROSSFADE_OUT_END_PROGRESS = 0.55;
export const V2_FILE_SCAN_START_FRAME = V2_TYPING_DURATION_FRAMES - V2_TRANSITION_DURATION_FRAMES;
export const V2_DIAGNOSE_START_FRAME =
  V2_FILE_SCAN_START_FRAME + V2_FILE_SCAN_DURATION_FRAMES - V2_TRANSITION_DURATION_FRAMES;
export const V2_SCORE_START_FRAME = V2_DIAGNOSE_START_FRAME + V2_DIAGNOSE_DURATION_FRAMES;
export const V2_TOTAL_DURATION_FRAMES = V2_SCORE_START_FRAME + V2_SCORE_DURATION_FRAMES;
export const V2_FINAL_TRANSITION_FRAMES = 12;

export const V2_TYPING_FONT_SIZE_PX = 100;
export const V2_TYPING_DELAY_FRAMES = 10;
export const V2_TYPING_BACKGROUND_FADE_START_FRAME = 60;
export const V2_TYPING_BACKGROUND_FADE_DURATION_FRAMES = 15;
export const V2_TYPING_BACKGROUND_OPACITY = 0.07;
export const V2_TYPING_CONTENT_LEFT_PADDING_PX = 160;
export const V2_TYPING_CONTENT_RIGHT_PADDING_PX = 80;

export const V2_SCAN_FONT_SIZE_PX = 48;
export const V2_SCAN_LINE_HEIGHT = 1.6;
export const V2_SCAN_ROW_VERTICAL_PADDING_PX = 4;
export const V2_SCAN_ROW_HORIZONTAL_PADDING_PX = 24;
export const V2_SCAN_ROW_GAP_PX = 24;
export const V2_SCAN_CONTENT_VERTICAL_PADDING_PX = 40;
export const V2_SCAN_CONTENT_HORIZONTAL_PADDING_PX = 60;
export const V2_SCAN_BADGE_SIZE_PX = 44;
export const V2_SCAN_BADGE_RADIUS_PX = 6;
export const V2_SCAN_FRAMES_PER_ISSUE = 2;
export const V2_SCAN_ROW_FADE_DURATION_FRAMES = 6;
export const V2_SCAN_SCROLL_START_FRAME = 20;
export const V2_SCAN_SCROLL_DISTANCE_RATIO = 0.15;
export const V2_SCAN_SCROLL_REFERENCE_FRAMES = 40;
export const V2_SCAN_TITLE_FONT_SIZE_PX = 88;
export const V2_SCAN_TITLE_FADE_START_FRAME = 5;
export const V2_SCAN_TITLE_FADE_DURATION_FRAMES = 12;
export const V2_SCAN_OVERLAY_HEIGHT_PX = 400;
export const V2_SCAN_OVERLAY_TOP_PADDING_PX = 80;
export const V2_SCAN_OVERLAY_HORIZONTAL_PADDING_PX = 120;

export const V2_HERO_SCORE = 42;
export const V2_PERFECT_SCORE = 100;
export const V2_SCORE_ANIMATION_DURATION_FRAMES = 20;
export const V2_SCORE_FACE_SIZE_PX = 280;
export const V2_SCORE_NUMBER_FONT_SIZE_PX = 140;
export const V2_SCORE_LABEL_FONT_SIZE_PX = 56;
export const V2_SCORE_BAR_WIDTH_PX = 900;
export const V2_SCORE_HERO_TOP_PX = 348;
export const V2_SCORE_HERO_LEFT_PX = 350;
export const V2_SCORE_BADGE_TOP_PX = 840;
export const V2_SCORE_BADGE_LEFT_PX = 80;
export const V2_SCORE_BADGE_NUMBER_FONT_SIZE_PX = 64;
export const V2_SCORE_BADGE_LABEL_FONT_SIZE_PX = 40;
export const V2_SCORE_BADGE_BAR_HEIGHT_PX = 32;
export const V2_SCORE_HERO_HOLD_END_FRAME = 40;
export const V2_SCORE_TRANSITION_END_FRAME = 70;

export const V2_CLAUDE_HORIZONTAL_PADDING_PX = 80;
export const V2_CLAUDE_TOP_PADDING_PX = 60;
export const V2_CLAUDE_PROMPT_TOP_PX = 280;
export const V2_CLAUDE_STATUS_TOP_PX = 380;
export const V2_CLAUDE_ITEMS_TOP_PX = 460;
export const V2_CLAUDE_LIST_HEIGHT_PX = 350;
export const V2_CLAUDE_LIST_FADE_HEIGHT_PX = 60;
export const V2_CLAUDE_LOGO_SIZE_PX = 220;
export const V2_CLAUDE_TITLE_FONT_SIZE_PX = 42;
export const V2_CLAUDE_META_FONT_SIZE_PX = 30;
export const V2_CLAUDE_HEADER_GAP_PX = 28;
export const V2_CLAUDE_HEADER_RESTING_OPACITY = 0.72;
export const V2_CLAUDE_PROMPT_FONT_SIZE_PX = 44;
export const V2_CLAUDE_DIAGNOSTIC_FONT_SIZE_PX = 32;
export const V2_CLAUDE_STATUS_FONT_SIZE_PX = 36;
export const V2_CLAUDE_HEADER_FADE_START_FRAME = 55;
export const V2_CLAUDE_HEADER_FADE_DURATION_FRAMES = 12;
export const V2_CLAUDE_HEADER_SLIDE_PX = 30;
export const V2_CLAUDE_ITEMS_START_FRAME = 78;
export const V2_CLAUDE_FIX_START_FRAME = 106;
export const V2_CLAUDE_FIX_INTERVAL_FRAMES = 1;
export const V2_CLAUDE_FIX_FADE_DURATION_FRAMES = 3;
export const V2_CLAUDE_SPINNER_START_FRAME = 75;
export const V2_CLAUDE_SPINNER_DURATION_FRAMES = 3;
export const V2_CLAUDE_DONE_FADE_DURATION_FRAMES = 8;
export const V2_CLAUDE_COLOR = "#d77757";

export const V2_SCANNED_ISSUES: V2ScannedIssue[] = [
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
  { message: "Proper use of useMemo", severity: "ok", pointsLost: 0, file: "Table.tsx:42" },
  { message: "Correct key usage in list", severity: "ok", pointsLost: 0, file: "NavBar.tsx:26" },
  { message: "Clean effect cleanup", severity: "ok", pointsLost: 0, file: "Timer.tsx:15" },
  {
    message: "Server action missing auth check",
    severity: "error",
    pointsLost: 5,
    file: "deleteUser.ts:3",
  },
  {
    message: "Prop drilling through 4+ levels",
    severity: "warning",
    pointsLost: 2,
    file: "Layout.tsx:12",
  },
  {
    message: "useCallback with empty deps",
    severity: "ok",
    pointsLost: 0,
    file: "Search.tsx:31",
  },
  {
    message: "Suspense boundary in place",
    severity: "ok",
    pointsLost: 0,
    file: "page.tsx:7",
  },
  {
    message: "Lazy loading configured",
    severity: "ok",
    pointsLost: 0,
    file: "routes.tsx:4",
  },
  {
    message: "Accessible form labels",
    severity: "ok",
    pointsLost: 0,
    file: "LoginForm.tsx:19",
  },
  {
    message: "State reset on unmount",
    severity: "ok",
    pointsLost: 0,
    file: "Wizard.tsx:38",
  },
  {
    message: "Ref used for non-reactive value",
    severity: "ok",
    pointsLost: 0,
    file: "Video.tsx:22",
  },
  {
    message: "useEffect runs on every render",
    severity: "error",
    pointsLost: 5,
    file: "Tooltip.tsx:9",
  },
  {
    message: "Spreading props without filtering",
    severity: "warning",
    pointsLost: 2,
    file: "Input.tsx:5",
  },
  {
    message: "forwardRef used correctly",
    severity: "ok",
    pointsLost: 0,
    file: "Select.tsx:14",
  },
  {
    message: "Event handler recreated each render",
    severity: "warning",
    pointsLost: 2,
    file: "Card.tsx:47",
  },
  {
    message: "Deeply nested ternary in JSX",
    severity: "warning",
    pointsLost: 2,
    file: "Status.tsx:33",
  },
  {
    message: "Missing loading state for async data",
    severity: "warning",
    pointsLost: 2,
    file: "Posts.tsx:21",
  },
  {
    message: "useReducer for complex state",
    severity: "ok",
    pointsLost: 0,
    file: "Form.tsx:8",
  },
  {
    message: "Mutable ref for interval ID",
    severity: "ok",
    pointsLost: 0,
    file: "Countdown.tsx:11",
  },
  {
    message: "setState called during render",
    severity: "error",
    pointsLost: 5,
    file: "Filter.tsx:28",
  },
  {
    message: "Large bundle from barrel import",
    severity: "warning",
    pointsLost: 2,
    file: "index.ts:1",
  },
  {
    message: "Uncontrolled to controlled switch",
    severity: "error",
    pointsLost: 5,
    file: "Toggle.tsx:16",
  },
  {
    message: "Layout thrashing in useLayoutEffect",
    severity: "error",
    pointsLost: 5,
    file: "Resize.tsx:39",
  },
  {
    message: "Proper Suspense fallback",
    severity: "ok",
    pointsLost: 0,
    file: "loading.tsx:3",
  },
  {
    message: "Memo comparison function correct",
    severity: "ok",
    pointsLost: 0,
    file: "Row.tsx:52",
  },
  {
    message: "Async setState after unmount",
    severity: "error",
    pointsLost: 5,
    file: "Upload.tsx:44",
  },
  {
    message: "Missing key in Fragment list",
    severity: "error",
    pointsLost: 5,
    file: "Tabs.tsx:20",
  },
];

export const V2_DIAGNOSTICS = V2_SCANNED_ISSUES.filter(
  (issue) => issue.severity === "error" || issue.severity === "warning",
);
