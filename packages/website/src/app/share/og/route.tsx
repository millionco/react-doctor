import { ImageResponse } from "next/og";
import { PERFECT_SCORE, SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "@/constants";
import { clampScore } from "@/utils/clamp-score";
import { getScoreLabel } from "@/utils/get-score-label";

const IMAGE_WIDTH_PX = 1200;
const IMAGE_HEIGHT_PX = 630;
const OG_BRAND_MARK_WIDTH_PX = 244;
const OG_BRAND_MARK_HEIGHT_PX = 82;
const OG_BRAND_MARK_PATH = "/react-doctor-og-banner.svg";
const MAX_PROJECT_NAME_LENGTH = 100;
const MAX_DISPLAY_COUNT = 99_999;
const OG_CACHE_SECONDS = 60 * 60 * 24;

const getScoreColor = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "#4ade80";
  if (score >= SCORE_OK_THRESHOLD) return "#eab308";
  return "#f87171";
};

const clampDisplayCount = (raw: number): number => Math.max(0, Math.min(MAX_DISPLAY_COUNT, raw));

// HACK: next/og (Satori) renders via inline `style` only — CSS classes,
// Tailwind utilities, and CSS modules are not supported, so style objects
// are hoisted to module scope to keep render bodies compact and reusable.
const OG_CONTAINER_STYLE = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  backgroundColor: "#0a0a0a",
  fontFamily: "monospace",
  padding: "60px 80px",
  justifyContent: "center",
} as const;

const OG_HEADER_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: "24px",
} as const;

const OG_PROJECT_LABEL_STYLE = {
  display: "flex",
  marginLeft: "auto",
  fontSize: "24px",
  color: "#a3a3a3",
} as const;

const OG_SCORE_ROW_STYLE = {
  display: "flex",
  alignItems: "baseline",
  gap: "16px",
  marginTop: "48px",
} as const;

const OG_SCORE_LABEL_STYLE = {
  fontSize: "40px",
  color: "#525252",
  lineHeight: 1,
} as const;

const OG_SCORE_BAR_TRACK_STYLE = {
  display: "flex",
  width: "100%",
  height: "16px",
  backgroundColor: "#1a1a1a",
  borderRadius: "8px",
  marginTop: "32px",
  overflow: "hidden",
} as const;

const OG_COUNTS_ROW_STYLE = {
  display: "flex",
  gap: "24px",
  marginTop: "36px",
  fontSize: "24px",
} as const;

export const GET = (request: Request): ImageResponse => {
  const { searchParams } = new URL(request.url);

  const rawProjectName = searchParams.get("p");
  const projectName =
    rawProjectName && rawProjectName.length > 0
      ? rawProjectName.slice(0, MAX_PROJECT_NAME_LENGTH)
      : null;
  const score = clampScore(Number(searchParams.get("s")) || 0);
  const errorCount = clampDisplayCount(Number(searchParams.get("e")) || 0);
  const warningCount = clampDisplayCount(Number(searchParams.get("w")) || 0);
  const fileCount = clampDisplayCount(Number(searchParams.get("f")) || 0);
  const scoreColor = getScoreColor(score);
  const brandMarkUrl = new URL(OG_BRAND_MARK_PATH, request.url).toString();
  const scoreBarPercent = (score / PERFECT_SCORE) * 100;

  const scoreValueStyle = { fontSize: "120px", color: scoreColor, fontWeight: 700, lineHeight: 1 };
  const scoreOutcomeStyle = { ...OG_SCORE_LABEL_STYLE, color: scoreColor, marginLeft: "8px" };
  const scoreBarFillStyle = {
    width: `${scoreBarPercent}%`,
    height: "100%",
    backgroundColor: scoreColor,
    borderRadius: "8px",
  };

  return new ImageResponse(
    <div style={OG_CONTAINER_STYLE}>
      <div style={OG_HEADER_STYLE}>
        <img
          src={brandMarkUrl}
          alt="React Doctor"
          width={OG_BRAND_MARK_WIDTH_PX}
          height={OG_BRAND_MARK_HEIGHT_PX}
        />
        {projectName && <div style={OG_PROJECT_LABEL_STYLE}>{projectName}</div>}
      </div>

      <div style={OG_SCORE_ROW_STYLE}>
        <span style={scoreValueStyle}>{score}</span>
        <span style={OG_SCORE_LABEL_STYLE}>/ {PERFECT_SCORE}</span>
        <span style={scoreOutcomeStyle}>{getScoreLabel(score)}</span>
      </div>

      <div style={OG_SCORE_BAR_TRACK_STYLE}>
        <div style={scoreBarFillStyle} />
      </div>

      {(errorCount > 0 || warningCount > 0 || fileCount > 0) && (
        <div style={OG_COUNTS_ROW_STYLE}>
          {errorCount > 0 && (
            <span style={{ color: "#f87171" }}>
              {errorCount} error{errorCount === 1 ? "" : "s"}
            </span>
          )}
          {warningCount > 0 && (
            <span style={{ color: "#eab308" }}>
              {warningCount} warning{warningCount === 1 ? "" : "s"}
            </span>
          )}
          {fileCount > 0 && (
            <span style={{ color: "#737373" }}>
              across {fileCount} file{fileCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
    </div>,
    {
      width: IMAGE_WIDTH_PX,
      height: IMAGE_HEIGHT_PX,
      headers: {
        "Cache-Control": `public, max-age=${OG_CACHE_SECONDS}, s-maxage=${OG_CACHE_SECONDS}, immutable`,
      },
    },
  );
};
