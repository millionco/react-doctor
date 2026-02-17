export const VIDEO_WIDTH_PX = 1920;
export const VIDEO_HEIGHT_PX = 1080;
export const VIDEO_FPS = 30;

export const BACKGROUND_COLOR = "#0a0a0a";
export const TEXT_COLOR = "#d4d4d8";
export const MUTED_COLOR = "#737373";
export const RED_COLOR = "#f87171";
export const GREEN_COLOR = "#4ade80";
export const YELLOW_COLOR = "#eab308";
export const OVERLAY_GRADIENT_RGB = "10, 10, 10";
export const OVERLAY_GRADIENT_HEIGHT_PX = 420;
export const OVERLAY_GRADIENT_HORIZONTAL_PADDING_PX = 120;
export const OVERLAY_GRADIENT_BOTTOM_PADDING_PX = 80;
export const OVERLAY_GRADIENT_BOTTOM_ALPHA = 0.96;
export const OVERLAY_GRADIENT_MIDDLE_ALPHA = 0.55;
export const OVERLAY_GRADIENT_MIDDLE_STOP_PERCENT = 50;

export const COMMAND = "npx -y react-doctor@latest";
export const CONTENT_WIDTH_PX = 1400;

export const TYPING_FONT_SIZE_PX = 100;
export const TYPING_CHAR_WIDTH_PX = 60;
export const CHAR_FRAMES = 2;
export const CURSOR_BLINK_FRAMES = 16;
export const TYPING_INITIAL_DELAY_FRAMES = 15;
export const TYPING_POST_PAUSE_FRAMES = 24;
export const TYPING_PAN_THRESHOLD_PX = CONTENT_WIDTH_PX * 0.6;

export const FILE_SCAN_FONT_SIZE_PX = 48;
export const FRAMES_PER_FILE = 3;
export const FILE_SCAN_INITIAL_DELAY_FRAMES = 5;
export const FILE_SCAN_VISIBLE_ROWS = 14;
export const SCANNED_FILES = [
  { path: "src/components/Button.tsx", errors: 0, warnings: 1 },
  { path: "src/components/UserCard.tsx", errors: 2, warnings: 0 },
  { path: "src/components/Dashboard.tsx", errors: 1, warnings: 2 },
  { path: "src/components/Modal.tsx", errors: 0, warnings: 0 },
  { path: "src/components/Sidebar.tsx", errors: 0, warnings: 1 },
  { path: "src/components/Header.tsx", errors: 1, warnings: 0 },
  { path: "src/components/Footer.tsx", errors: 0, warnings: 0 },
  { path: "src/components/NavBar.tsx", errors: 0, warnings: 1 },
  { path: "src/components/Avatar.tsx", errors: 0, warnings: 0 },
  { path: "src/components/Tooltip.tsx", errors: 0, warnings: 1 },
  { path: "src/components/Dropdown.tsx", errors: 1, warnings: 0 },
  { path: "src/components/Table.tsx", errors: 0, warnings: 2 },
  { path: "src/hooks/useAuth.ts", errors: 3, warnings: 1 },
  { path: "src/hooks/useDebounce.ts", errors: 0, warnings: 0 },
  { path: "src/hooks/useFetch.ts", errors: 2, warnings: 1 },
  { path: "src/hooks/useLocalStorage.ts", errors: 0, warnings: 0 },
  { path: "src/hooks/useMediaQuery.ts", errors: 0, warnings: 1 },
  { path: "src/hooks/useClickOutside.ts", errors: 0, warnings: 0 },
  { path: "src/hooks/useForm.ts", errors: 1, warnings: 2 },
  { path: "src/hooks/useThrottle.ts", errors: 0, warnings: 0 },
  { path: "src/pages/Home.tsx", errors: 1, warnings: 3 },
  { path: "src/pages/Settings.tsx", errors: 0, warnings: 1 },
  { path: "src/pages/Profile.tsx", errors: 2, warnings: 0 },
  { path: "src/pages/Login.tsx", errors: 0, warnings: 0 },
  { path: "src/pages/Register.tsx", errors: 1, warnings: 1 },
  { path: "src/pages/NotFound.tsx", errors: 0, warnings: 0 },
  { path: "src/pages/Dashboard.tsx", errors: 2, warnings: 1 },
  { path: "src/pages/Checkout.tsx", errors: 0, warnings: 2 },
  { path: "src/actions/deleteUser.ts", errors: 1, warnings: 0 },
  { path: "src/actions/updateProfile.ts", errors: 0, warnings: 1 },
  { path: "src/actions/createPost.ts", errors: 1, warnings: 0 },
  { path: "src/actions/uploadFile.ts", errors: 0, warnings: 0 },
  { path: "src/actions/sendEmail.ts", errors: 1, warnings: 1 },
  { path: "src/utils/format.ts", errors: 0, warnings: 0 },
  { path: "src/utils/validate.ts", errors: 0, warnings: 1 },
  { path: "src/utils/debounce.ts", errors: 0, warnings: 0 },
  { path: "src/utils/cn.ts", errors: 0, warnings: 0 },
  { path: "src/utils/date.ts", errors: 0, warnings: 1 },
  { path: "src/utils/slug.ts", errors: 0, warnings: 0 },
  { path: "src/context/ThemeProvider.tsx", errors: 1, warnings: 2 },
  { path: "src/context/AuthProvider.tsx", errors: 3, warnings: 0 },
  { path: "src/context/CartProvider.tsx", errors: 0, warnings: 1 },
  { path: "src/context/NotificationProvider.tsx", errors: 1, warnings: 0 },
  { path: "src/lib/api.ts", errors: 2, warnings: 1 },
  { path: "src/lib/db.ts", errors: 0, warnings: 0 },
  { path: "src/lib/cache.ts", errors: 1, warnings: 0 },
  { path: "src/lib/redis.ts", errors: 0, warnings: 1 },
  { path: "src/lib/stripe.ts", errors: 0, warnings: 0 },
  { path: "src/lib/email.ts", errors: 1, warnings: 0 },
  { path: "src/middleware/auth.ts", errors: 2, warnings: 1 },
  { path: "src/middleware/rateLimit.ts", errors: 0, warnings: 0 },
  { path: "src/middleware/cors.ts", errors: 0, warnings: 1 },
  { path: "src/middleware/logging.ts", errors: 0, warnings: 0 },
  { path: "src/types/user.ts", errors: 0, warnings: 0 },
  { path: "src/types/post.ts", errors: 0, warnings: 0 },
  { path: "src/types/api.ts", errors: 0, warnings: 1 },
  { path: "src/config/env.ts", errors: 0, warnings: 0 },
];

export const DIAGNOSTIC_FONT_SIZE_PX = 28;
export const DIAGNOSTIC_LINE_HEIGHT = 1.7;
export const FRAMES_PER_DIAGNOSTIC = 4;
export const DIAGNOSTIC_INITIAL_DELAY_FRAMES = 15;
export const SCORE_PAUSE_FRAMES = 18;
export const SCORE_ANIMATION_FRAMES = 20;
export const POST_SCORE_PAUSE_FRAMES = 21;
export const TARGET_SCORE = 42;
export const PERFECT_SCORE = 100;
export const TOTAL_ERROR_COUNT = 22;
export const AFFECTED_FILE_COUNT = 18;
export const ELAPSED_TIME = "2.1s";
export const SCORE_BAR_WIDTH = 30;

export const DIAGNOSTICS = [
  {
    message: "Derived state computed in useEffect, compute during render instead",
    count: 5,
  },
  {
    message: 'Server action "deleteUser" missing authentication check',
    count: 2,
  },
  {
    message: "Array index used as key, causes bugs when items are reordered",
    count: 12,
  },
  {
    message: 'Component "UserCard" inside "Dashboard", destroys state every render',
    count: 4,
  },
  {
    message: "Data fetched in useEffect without cleanup, causes race conditions",
    count: 8,
  },
  {
    message: "useState initialized from prop, derive during render instead of syncing",
    count: 3,
  },
  {
    message: "Missing prefers-reduced-motion check for animations",
    count: 2,
  },
];

export const BOX_TOP = "┌─────┐";
export const BOX_BOTTOM = "└─────┘";

export const FRAMES_PER_FIX = 20;
export const FIX_INITIAL_DELAY_FRAMES = 15;

export const SCENE_TYPING_DURATION_FRAMES = 100;
export const SCENE_FILE_SCAN_DURATION_FRAMES = 185;
export const SCENE_DIAGNOSTICS_DURATION_FRAMES = 135;
export const SCENE_FIXES_DURATION_FRAMES = 195;
export const SCENE_CTA_DURATION_FRAMES = 90;
export const SCENE_AGENT_HANDOFF_DURATION_FRAMES = 140;
export const SCENE_SCORE_REVEAL_DURATION_FRAMES = 110;
export const TRANSITION_DURATION_FRAMES = 15;

export const TOTAL_DURATION =
  SCENE_TYPING_DURATION_FRAMES +
  SCENE_FILE_SCAN_DURATION_FRAMES +
  SCENE_DIAGNOSTICS_DURATION_FRAMES +
  SCENE_AGENT_HANDOFF_DURATION_FRAMES +
  SCENE_SCORE_REVEAL_DURATION_FRAMES -
  TRANSITION_DURATION_FRAMES;
