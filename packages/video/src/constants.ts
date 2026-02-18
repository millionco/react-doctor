export const VIDEO_WIDTH_PX = 1920;
export const VIDEO_HEIGHT_PX = 1080;
export const VIDEO_FPS = 30;

export const BACKGROUND_COLOR = "#0a0a0a";
export const TEXT_COLOR = "#d4d4d8";
export const MUTED_COLOR = "#737373";
export const RED_COLOR = "#f87171";
export const GREEN_COLOR = "#4ade80";
export const YELLOW_COLOR = "#eab308";

export const PERFECT_SCORE = 100;
export const SCORE_GOOD_THRESHOLD = 75;
export const SCORE_OK_THRESHOLD = 50;

export const ORIGINAL_SCORE = 60;
export const IMPROVED_SCORE = 87;

interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
}

export const LEADERBOARD_ENTRIES: LeaderboardEntry[] = [
  { name: "tldraw", score: 84 },
  { name: "excalidraw", score: 84 },
  { name: "formbricks", score: 75 },
  { name: "posthog", score: 72 },
  { name: "supabase", score: 69 },
  { name: "onlook", score: 69 },
  { name: "payload", score: 68 },
  { name: "sentry", score: 64 },
  { name: "dub", score: 62 },
  { name: "cal.com", score: ORIGINAL_SCORE },
].map((entry, index) => ({ ...entry, rank: index + 1 }));

export const CAL_ENTRY_INDEX = LEADERBOARD_ENTRIES.findIndex((entry) => entry.name === "cal.com");

export const LEADERBOARD_BAR_WIDTH = 16;

export const TOTAL_DURATION = 255;
