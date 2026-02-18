import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  BACKGROUND_COLOR,
  GREEN_COLOR,
  IMPROVED_SCORE,
  LEADERBOARD_BAR_WIDTH,
  LEADERBOARD_ENTRIES,
  MUTED_COLOR,
  ORIGINAL_SCORE,
  PERFECT_SCORE,
  RED_COLOR,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  TEXT_COLOR,
  YELLOW_COLOR,
} from "../constants";

import { fontFamily } from "../utils/font";

const ROW_FONT_SIZE_PX = 38;
const ROW_LINE_HEIGHT = 1.85;
const ROW_HEIGHT_PX = ROW_FONT_SIZE_PX * ROW_LINE_HEIGHT;
const TITLE_FONT_SIZE_PX = 48;
const BORDER_WIDTH_PX = 3;
const PAD_V_PX = 4;
const PAD_H_PX = 12;
const ROW_TOTAL_HEIGHT_PX = ROW_HEIGHT_PX + PAD_V_PX * 2 + BORDER_WIDTH_PX * 2;

const FADE_IN_STAGGER_FRAMES = 2;
const FADE_IN_DURATION_FRAMES = 6;
const HEADER_FADE_FRAMES = 8;

const HIGHLIGHT_START_FRAMES = 50;
const HIGHLIGHT_FADE_FRAMES = 12;

const CLIMB_START_FRAMES = 90;
const CLIMB_DURATION_FRAMES = 60;

const ORIGINAL_INDEX = LEADERBOARD_ENTRIES.findIndex((entry) => entry.name === "cal.com");

const entriesWithoutCal = LEADERBOARD_ENTRIES.filter((entry) => entry.name !== "cal.com");
const sortedAfterClimb = [
  ...entriesWithoutCal,
  { rank: 0, name: "cal.com", score: IMPROVED_SCORE },
].sort((entryA, entryB) => entryB.score - entryA.score);
const TARGET_INDEX = sortedAfterClimb.findIndex((entry) => entry.name === "cal.com");
const POSITIONS_TO_CLIMB = ORIGINAL_INDEX - TARGET_INDEX;

const getScoreColor = (score: number) => {
  if (score >= SCORE_GOOD_THRESHOLD) return GREEN_COLOR;
  if (score >= SCORE_OK_THRESHOLD) return YELLOW_COLOR;
  return RED_COLOR;
};

const getScoreLabel = (score: number) => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "Needs work";
  return "Critical";
};

export const LeaderboardWithClimb = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, HEADER_FADE_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const highlightProgress = interpolate(
    frame,
    [HIGHLIGHT_START_FRAMES, HIGHLIGHT_START_FRAMES + HIGHLIGHT_FADE_FRAMES],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  const climbProgress = interpolate(
    frame,
    [CLIMB_START_FRAMES, CLIMB_START_FRAMES + CLIMB_DURATION_FRAMES],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
  );

  const isClimbing = frame >= CLIMB_START_FRAMES;

  const calScore = Math.round(interpolate(climbProgress, [0, 1], [ORIGINAL_SCORE, IMPROVED_SCORE]));
  const calScoreColor = getScoreColor(calScore);

  const calOffsetY = -climbProgress * POSITIONS_TO_CLIMB * ROW_TOTAL_HEIGHT_PX;

  const getDisplacedOffset = (index: number) => {
    if (index < TARGET_INDEX || index >= ORIGINAL_INDEX) return 0;
    return climbProgress * ROW_TOTAL_HEIGHT_PX;
  };

  const borderColor = isClimbing
    ? `rgba(74, 222, 128, ${Math.min(1, climbProgress * 3 + highlightProgress * 0.3)})`
    : `rgba(248, 113, 113, ${highlightProgress})`;

  const glowColor = isClimbing
    ? `0 0 ${24 * climbProgress}px rgba(74, 222, 128, ${climbProgress * 0.35})`
    : `0 0 ${20 * highlightProgress}px rgba(248, 113, 113, ${highlightProgress * 0.3})`;

  const scoreOverlayOpacity = frame >= CLIMB_START_FRAMES ? 1 : 0;

  const ZOOM_START_FRAMES = HIGHLIGHT_START_FRAMES;
  const ZOOM_DURATION_FRAMES = 25;
  const ZOOM_SCALE = 2.8;

  const zoomProgress = interpolate(
    frame,
    [ZOOM_START_FRAMES, ZOOM_START_FRAMES + ZOOM_DURATION_FRAMES],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
  );

  const INITIAL_SCALE = 2.2;
  const cameraScale = interpolate(zoomProgress, [0, 1], [INITIAL_SCALE, ZOOM_SCALE]);

  const calRowBottomPercent = ((ORIGINAL_INDEX + 0.5) / LEADERBOARD_ENTRIES.length) * 100;
  const calCurrentPercent =
    calRowBottomPercent + (calOffsetY / (LEADERBOARD_ENTRIES.length * ROW_TOTAL_HEIGHT_PX)) * 100;
  const originY = Math.min(85, calCurrentPercent);

  return (
    <AbsoluteFill style={{ backgroundColor: BACKGROUND_COLOR, overflow: "hidden" }}>
      <div
        style={{
          padding: "50px 120px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          transform: `scale(${cameraScale})`,
          transformOrigin: `0% ${originY}%`,
        }}
      >
        <div style={{ position: "relative" }}>
          {LEADERBOARD_ENTRIES.map((entry, index) => {
            const rowStartFrame = 8 + index * FADE_IN_STAGGER_FRAMES;
            const rowOpacity = interpolate(
              frame - rowStartFrame,
              [0, FADE_IN_DURATION_FRAMES],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              },
            );

            const isCalEntry = entry.name === "cal.com";
            const displayScore = isCalEntry ? calScore : entry.score;
            const scoreColor = getScoreColor(displayScore);
            const filledBarCount = Math.round(
              (displayScore / PERFECT_SCORE) * LEADERBOARD_BAR_WIDTH,
            );
            const emptyBarCount = LEADERBOARD_BAR_WIDTH - filledBarCount;

            const displayRank = isCalEntry
              ? Math.round(interpolate(climbProgress, [0, 1], [entry.rank, TARGET_INDEX + 1]))
              : (() => {
                  if (index < TARGET_INDEX || index >= ORIGINAL_INDEX) return entry.rank;
                  return Math.round(
                    interpolate(climbProgress, [0, 1], [entry.rank, entry.rank + 1]),
                  );
                })();

            const offsetY = isCalEntry ? calOffsetY : getDisplacedOffset(index);

            return (
              <div
                key={entry.name}
                style={{
                  opacity: rowOpacity,
                  fontFamily,
                  fontSize: ROW_FONT_SIZE_PX,
                  lineHeight: ROW_LINE_HEIGHT,
                  color: TEXT_COLOR,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  position: "relative",
                  margin: `0 -${PAD_H_PX}px`,
                  padding: `${PAD_V_PX}px ${PAD_H_PX}px`,
                  borderRadius: 6,
                  border: isCalEntry
                    ? `${BORDER_WIDTH_PX}px solid ${borderColor}`
                    : `${BORDER_WIDTH_PX}px solid transparent`,
                  boxShadow: isCalEntry ? glowColor : "none",
                  transform: `translateY(${offsetY}px)`,
                  zIndex: isCalEntry ? 10 : 1,
                  backgroundColor:
                    isCalEntry && isClimbing ? "rgba(74, 222, 128, 0.05)" : "transparent",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ color: MUTED_COLOR, width: 48, textAlign: "right" }}>
                    {displayRank}
                  </span>
                  <span
                    style={{
                      color: isCalEntry ? "white" : TEXT_COLOR,
                      fontWeight: isCalEntry ? 600 : 400,
                    }}
                  >
                    {entry.name}
                  </span>
                </span>

                <span style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ fontSize: ROW_FONT_SIZE_PX * 0.7, letterSpacing: 1 }}>
                    <span style={{ color: scoreColor }}>{"█".repeat(filledBarCount)}</span>
                    <span style={{ color: "#262626" }}>{"░".repeat(emptyBarCount)}</span>
                  </span>
                  <span>
                    <span style={{ color: scoreColor, fontWeight: 500 }}>{displayScore}</span>
                    <span style={{ color: MUTED_COLOR }}>/{PERFECT_SCORE}</span>
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "flex-end",
          padding: "48px 48px",
          opacity: scoreOverlayOpacity,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            textShadow: "0 0 40px rgba(0,0,0,0.9), 0 0 80px rgba(0,0,0,0.7)",
          }}
        >
          <div>
            <span
              style={{
                fontFamily,
                fontSize: 220,
                color: calScoreColor,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              {calScore}
            </span>
            <span style={{ fontFamily, fontSize: 80, color: MUTED_COLOR }}>
              {` / ${PERFECT_SCORE}`}
            </span>
          </div>
          <div style={{ fontFamily, fontSize: 68, color: calScoreColor }}>
            {getScoreLabel(calScore)}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
