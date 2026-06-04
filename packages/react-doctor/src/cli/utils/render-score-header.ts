import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  highlighter,
  PERFECT_SCORE,
  SCORE_BAR_WIDTH_CHARS,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
} from "@react-doctor/core";
import type { ScoreResult } from "@react-doctor/core";
import { colorizeByScore } from "./colorize-by-score.js";
import {
  PERFECT_SCORE_RAINBOW_FRAME_COUNT,
  PERFECT_SCORE_RAINBOW_FRAME_DELAY_MS,
  SCORE_HEADER_ANIMATION_FRAME_COUNT,
  SCORE_HEADER_ANIMATION_FRAME_DELAY_MS,
  SCORE_PROJECTION_FRAME_COUNT,
  SCORE_PROJECTION_FRAME_DELAY_MS,
} from "./constants.js";
import { easeOutCubic } from "./ease-out-cubic.js";
import { canAnimateOnboarding } from "./onboarding-pacing.js";
import { isSpinnerSilent } from "./spinner.js";
import { writeStdout } from "./write-stdout.js";

const RAINBOW_HUE_SHIFT_PER_FRAME = 9;
const RAINBOW_GRADIENT_WIDTH = 80;
const RAINBOW_OKLCH_LIGHTNESS = 0.638;
const RAINBOW_OKLCH_CHROMA = 0.129;

interface ScoreBarSegments {
  filledSegment: string;
  emptySegment: string;
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

interface RainbowFrameInput {
  score: number;
  displayScore: number;
  label: string;
  frame: number;
}

interface InitialScoreHeaderLineInput {
  isPerfectScore: boolean;
  shouldAnimate: boolean;
  lineIndex: number;
  renderedFaceLine: string;
  rawFaceLine: string;
  rightColumnContent: string;
  rawRightColumnContent: string;
  score: number;
}

const buildScoreBarSegments = (filledCount: number): ScoreBarSegments => {
  const emptyCount = SCORE_BAR_WIDTH_CHARS - filledCount;

  return {
    filledSegment: "█".repeat(filledCount),
    emptySegment: "░".repeat(emptyCount),
  };
};

const getFilledCount = (score: number): number =>
  Math.round((score / PERFECT_SCORE) * SCORE_BAR_WIDTH_CHARS);

const joinScoreHeaderFrame = (lines: [string, string, string, string]): string =>
  `${lines[0]}\n\r${lines[1]}\n\r${lines[2]}\n\r${lines[3]}\n`;

const buildRawScoreBar = (displayScore: number): string => {
  const { filledSegment, emptySegment } = buildScoreBarSegments(getFilledCount(displayScore));
  return filledSegment + emptySegment;
};

const buildScoreHeaderLine = (faceLine: string, rightColumnContent: string): string => {
  const separator = rightColumnContent.length > 0 ? "  " : "";
  return `  ${faceLine}${separator}${rightColumnContent}`;
};

const getRightColumnOffset = (faceLine: string): number => `  ${faceLine}  `.length;

const clampColorChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const encodeSrgb = (value: number): number =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

const oklchToRgb = (lightness: number, chroma: number, hue: number): RgbColor => {
  const hueRadians = (hue * Math.PI) / 180;
  const labA = chroma * Math.cos(hueRadians);
  const labB = chroma * Math.sin(hueRadians);
  const longCone = (lightness + 0.3963377774 * labA + 0.2158037573 * labB) ** 3;
  const mediumCone = (lightness - 0.1055613458 * labA - 0.0638541728 * labB) ** 3;
  const shortCone = (lightness - 0.0894841775 * labA - 1.291485548 * labB) ** 3;

  return {
    red: clampColorChannel(
      encodeSrgb(4.0767416621 * longCone - 3.3077115913 * mediumCone + 0.2309699292 * shortCone) *
        255,
    ),
    green: clampColorChannel(
      encodeSrgb(-1.2684380046 * longCone + 2.6097574011 * mediumCone - 0.3413193965 * shortCone) *
        255,
    ),
    blue: clampColorChannel(
      encodeSrgb(-0.0041960863 * longCone - 0.7034186147 * mediumCone + 1.707614701 * shortCone) *
        255,
    ),
  };
};

const colorizeTrueColor = (text: string, { red, green, blue }: RgbColor): string =>
  `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`;

const colorizeRainbowText = (text: string, frame: number, offset = 0): string =>
  [...text]
    .map((character, index) => {
      if (character === " ") return character;
      const hue =
        (((index + offset) / RAINBOW_GRADIENT_WIDTH) * 360 + frame * RAINBOW_HUE_SHIFT_PER_FRAME) %
        360;
      return colorizeTrueColor(
        character,
        oklchToRgb(RAINBOW_OKLCH_LIGHTNESS, RAINBOW_OKLCH_CHROMA, hue),
      );
    })
    .join("");

const buildRainbowHeaderLine = (
  faceLine: string,
  rightColumnContent: string,
  frame: number,
): string => colorizeRainbowText(buildScoreHeaderLine(faceLine, rightColumnContent), frame);

const buildScoreBar = (displayScore: number, colorScore = displayScore): string => {
  const { filledSegment, emptySegment } = buildScoreBarSegments(getFilledCount(displayScore));
  return colorizeByScore(filledSegment, colorScore) + highlighter.dim(emptySegment);
};

// Bar with a "ghost" gain segment: solid fill up to the current score,
// then `▓` in the same fill color but dimmed for the points you'd reclaim
// by fixing the top errors, then the dim remainder. Same total width as
// the plain bar, so layout is unchanged.
const buildProjectedScoreBar = (currentScore: number, potentialScore: number): string => {
  const currentFill = getFilledCount(currentScore);
  const potentialFill = Math.min(getFilledCount(potentialScore), SCORE_BAR_WIDTH_CHARS);
  const gainCount = Math.max(0, potentialFill - currentFill);
  const emptyCount = Math.max(0, SCORE_BAR_WIDTH_CHARS - currentFill - gainCount);
  return (
    colorizeByScore("█".repeat(currentFill), currentScore) +
    highlighter.dim(colorizeByScore("▓".repeat(gainCount), currentScore)) +
    highlighter.dim("░".repeat(emptyCount))
  );
};

const getDoctorFace = (score: number): string[] => {
  if (score >= SCORE_GOOD_THRESHOLD) return ["◠ ◠", " ▽ "];
  if (score >= SCORE_OK_THRESHOLD) return ["• •", " ─ "];
  return ["x x", " ▽ "];
};

const BRANDING_LINE = `React Doctor ${highlighter.dim("(https://react.doctor)")}`;
const RAW_BRANDING_LINE = "React Doctor (https://react.doctor)";

const buildRawFaceLines = (score: number): string[] => {
  const [eyes, mouth] = getDoctorFace(score);
  return ["┌─────┐", `│ ${eyes} │`, `│ ${mouth} │`, "└─────┘"];
};

const buildFaceRenderedLines = (score: number): string[] => {
  const colorize = (text: string) => colorizeByScore(text, score);
  return buildRawFaceLines(score).map(colorize);
};

const buildScoreLine = (displayScore: number, finalScore: number, label: string): string => {
  const scoreNumber = colorizeByScore(`${displayScore}`, finalScore);
  const scoreLabel = colorizeByScore(label, finalScore);
  return `${scoreNumber} ${highlighter.dim(`/ ${PERFECT_SCORE}`)} ${scoreLabel}`;
};

const buildRawScoreLine = (displayScore: number, label: string): string =>
  `${displayScore} / ${PERFECT_SCORE} ${label}`;

const buildRainbowScoreHeaderFrame = ({
  score,
  displayScore,
  label,
  frame,
}: RainbowFrameInput): string => {
  const rawFaceLines = buildRawFaceLines(score);
  return joinScoreHeaderFrame([
    buildRainbowHeaderLine(rawFaceLines[0] ?? "", buildRawScoreLine(displayScore, label), frame),
    buildRainbowHeaderLine(rawFaceLines[1] ?? "", buildRawScoreBar(displayScore), frame),
    buildRainbowHeaderLine(rawFaceLines[2] ?? "", RAW_BRANDING_LINE, frame),
    buildRainbowHeaderLine(rawFaceLines[3] ?? "", "", frame),
  ]);
};

const buildFinalPerfectScoreHeaderFrame = (score: number, label: string, frame: number): string => {
  const rawFaceLines = buildRawFaceLines(score);
  const renderedFaceLines = buildFaceRenderedLines(score);
  const rainbowBarLine = colorizeRainbowText(
    buildRawScoreBar(score),
    frame,
    getRightColumnOffset(rawFaceLines[1] ?? ""),
  );
  return joinScoreHeaderFrame([
    buildScoreHeaderLine(renderedFaceLines[0] ?? "", buildScoreLine(score, score, label)),
    buildScoreHeaderLine(renderedFaceLines[1] ?? "", rainbowBarLine),
    buildScoreHeaderLine(renderedFaceLines[2] ?? "", BRANDING_LINE),
    buildScoreHeaderLine(renderedFaceLines[3] ?? "", ""),
  ]);
};

const buildInitialScoreHeaderLine = ({
  isPerfectScore,
  shouldAnimate,
  lineIndex,
  renderedFaceLine,
  rawFaceLine,
  rightColumnContent,
  rawRightColumnContent,
  score,
}: InitialScoreHeaderLineInput): string => {
  if (!isPerfectScore) return buildScoreHeaderLine(renderedFaceLine, rightColumnContent);
  if (shouldAnimate) return buildRainbowHeaderLine(rawFaceLine, rawRightColumnContent, 0);
  if (lineIndex !== 1) return buildScoreHeaderLine(renderedFaceLine, rightColumnContent);

  return buildScoreHeaderLine(
    renderedFaceLine,
    colorizeRainbowText(buildRawScoreBar(score), 0, getRightColumnOffset(rawFaceLine)),
  );
};

const printAnimatedScore = (
  scoreFaceLine: string,
  barFaceLine: string,
  score: number,
  label: string,
  potentialScore?: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const isPerfectScore = score === PERFECT_SCORE;

    for (let frame = 0; frame <= SCORE_HEADER_ANIMATION_FRAME_COUNT; frame += 1) {
      const progress = easeOutCubic(frame / SCORE_HEADER_ANIMATION_FRAME_COUNT);
      const animatedScore = Math.round(score * progress);
      if (isPerfectScore) {
        const cursorUp = frame === 0 ? "" : "\x1b[4A";
        yield* writeStdout(
          `${cursorUp}\r${buildRainbowScoreHeaderFrame({
            score,
            displayScore: animatedScore,
            label,
            frame,
          })}`,
        );
        if (frame < SCORE_HEADER_ANIMATION_FRAME_COUNT) {
          yield* Effect.sleep(SCORE_HEADER_ANIMATION_FRAME_DELAY_MS);
        }
        continue;
      }

      const animatedScoreLine = buildScoreLine(animatedScore, score, label);
      // Reveal the projection ghost only once the count-up settles on the
      // real score — mid-animation it would fight the filling bar.
      const isFinalFrame = frame === SCORE_HEADER_ANIMATION_FRAME_COUNT;
      const animatedBarLine =
        isFinalFrame && potentialScore !== undefined
          ? buildProjectedScoreBar(score, potentialScore)
          : buildScoreBar(animatedScore, score);
      // HACK: \x1b[2A moves cursor up 2 lines to overwrite both the
      // score number line and the bar line in place each frame.
      const cursorUp = frame === 0 ? "" : "\x1b[2A";
      yield* writeStdout(
        `${cursorUp}\r${buildScoreHeaderLine(scoreFaceLine, animatedScoreLine)}\n\r${buildScoreHeaderLine(barFaceLine, animatedBarLine)}\n`,
      );
      if (frame < SCORE_HEADER_ANIMATION_FRAME_COUNT) {
        yield* Effect.sleep(SCORE_HEADER_ANIMATION_FRAME_DELAY_MS);
      }
    }

    if (!isPerfectScore) return;

    for (let frame = 0; frame < PERFECT_SCORE_RAINBOW_FRAME_COUNT; frame += 1) {
      yield* writeStdout(
        `\x1b[4A\r${buildRainbowScoreHeaderFrame({
          score,
          displayScore: score,
          label,
          frame,
        })}`,
      );
      yield* Effect.sleep(PERFECT_SCORE_RAINBOW_FRAME_DELAY_MS);
    }

    yield* writeStdout(
      `\x1b[4A\r${buildFinalPerfectScoreHeaderFrame(score, label, PERFECT_SCORE_RAINBOW_FRAME_COUNT)}\x1b[2A`,
    );
  });

export const printScoreHeader = (
  scoreResult: ScoreResult,
  // The score reachable by fixing the top errors, drawn as a ghost gain
  // segment on the bar. Omitted when there's nothing to project.
  potentialScore?: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const isPerfectScore = scoreResult.score === PERFECT_SCORE;
    const renderedFaceLines = buildFaceRenderedLines(scoreResult.score);
    const rawFaceLines = buildRawFaceLines(scoreResult.score);
    const shouldAnimate = !isSpinnerSilent() && canAnimateOnboarding(process.stdout);

    const displayScore = shouldAnimate ? 0 : scoreResult.score;
    const scoreLine = buildScoreLine(displayScore, scoreResult.score, scoreResult.label);
    const scoreBarLine = shouldAnimate
      ? buildScoreBar(0, scoreResult.score)
      : potentialScore !== undefined
        ? buildProjectedScoreBar(scoreResult.score, potentialScore)
        : buildScoreBar(scoreResult.score);

    const rightColumnLines = [scoreLine, scoreBarLine, BRANDING_LINE, ""];
    const rawRightColumnLines = [
      buildRawScoreLine(displayScore, scoreResult.label),
      buildRawScoreBar(displayScore),
      RAW_BRANDING_LINE,
      "",
    ];

    for (let lineIndex = 0; lineIndex < renderedFaceLines.length; lineIndex += 1) {
      yield* Console.log(
        buildInitialScoreHeaderLine({
          isPerfectScore,
          shouldAnimate,
          lineIndex,
          renderedFaceLine: renderedFaceLines[lineIndex] ?? "",
          rawFaceLine: rawFaceLines[lineIndex] ?? "",
          rightColumnContent: rightColumnLines[lineIndex] ?? "",
          rawRightColumnContent: rawRightColumnLines[lineIndex] ?? "",
          score: scoreResult.score,
        }),
      );
    }
    yield* Console.log("");

    if (shouldAnimate) {
      // HACK: move cursor up to the score number line (5 lines up:
      // 4 face lines + 1 trailing blank) and animate score + bar
      // together, then move cursor back down past branding + blank.
      yield* writeStdout("\x1b[5A");
      yield* printAnimatedScore(
        renderedFaceLines[0],
        renderedFaceLines[1],
        scoreResult.score,
        scoreResult.label,
        potentialScore,
      );
      yield* writeStdout("\x1b[3B");
    }
  });

// Grows the score bar's projected "ghost gain" (▓) in, eased, synced with the
// "you could improve" line. `linesBelowBar` is the cursor's distance beneath the
// bar, so each frame redraws the bar in place and returns. No-op for a perfect
// score or no gain.
export const animateScoreProjection = (
  scoreResult: ScoreResult,
  potentialScore: number,
  linesBelowBar: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (scoreResult.score === PERFECT_SCORE || potentialScore <= scoreResult.score) return;
    const barFaceLine = buildFaceRenderedLines(scoreResult.score)[1] ?? "";
    for (let frame = 1; frame <= SCORE_PROJECTION_FRAME_COUNT; frame += 1) {
      const progress = easeOutCubic(frame / SCORE_PROJECTION_FRAME_COUNT);
      const displayedPotential =
        scoreResult.score + (potentialScore - scoreResult.score) * progress;
      const barLine = buildScoreHeaderLine(
        barFaceLine,
        buildProjectedScoreBar(scoreResult.score, displayedPotential),
      );
      yield* writeStdout(`\x1b[${linesBelowBar}A\r${barLine}\x1b[${linesBelowBar}B\r`);
      if (frame < SCORE_PROJECTION_FRAME_COUNT) {
        yield* Effect.sleep(SCORE_PROJECTION_FRAME_DELAY_MS);
      }
    }
  });

export const printBrandingOnlyHeader: Effect.Effect<void> = Effect.gen(function* () {
  yield* Console.log(`  ${BRANDING_LINE}`);
  yield* Console.log("");
});

export const printNoScoreHeader = (noScoreMessage: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Console.log(`  ${BRANDING_LINE}`);
    yield* Console.log(`  ${highlighter.gray(noScoreMessage)}`);
    yield* Console.log("");
  });
