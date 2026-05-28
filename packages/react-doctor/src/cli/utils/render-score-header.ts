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
} from "./constants.js";
import { isSpinnerInteractive } from "./is-spinner-interactive.js";
import { isSpinnerSilent } from "./spinner.js";

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
  projectName?: string;
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

const easeOutCubic = (progress: number): number => 1 - (1 - progress) ** 3;

const sleep = (milliseconds: number): Effect.Effect<void> =>
  Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

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

const writeScoreHeaderLine = (line: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stdout.write(line);
  });

const buildScoreLine = (
  displayScore: number,
  finalScore: number,
  label: string,
  projectName?: string,
): string => {
  const scoreNumber = colorizeByScore(`${displayScore}`, finalScore);
  const scoreLabel = colorizeByScore(label, finalScore);
  const projectSuffix = projectName
    ? ` ${highlighter.dim("·")} ${highlighter.dim(projectName)}`
    : "";
  return `${scoreNumber} ${highlighter.dim(`/ ${PERFECT_SCORE}`)} ${scoreLabel}${projectSuffix}`;
};

const buildRawScoreLine = (displayScore: number, label: string, projectName?: string): string => {
  const projectSuffix = projectName ? ` · ${projectName}` : "";
  return `${displayScore} / ${PERFECT_SCORE} ${label}${projectSuffix}`;
};

const buildRainbowScoreHeaderFrame = ({
  score,
  displayScore,
  label,
  frame,
  projectName,
}: RainbowFrameInput): string => {
  const rawFaceLines = buildRawFaceLines(score);
  return joinScoreHeaderFrame([
    buildRainbowHeaderLine(
      rawFaceLines[0] ?? "",
      buildRawScoreLine(displayScore, label, projectName),
      frame,
    ),
    buildRainbowHeaderLine(rawFaceLines[1] ?? "", buildRawScoreBar(displayScore), frame),
    buildRainbowHeaderLine(rawFaceLines[2] ?? "", RAW_BRANDING_LINE, frame),
    buildRainbowHeaderLine(rawFaceLines[3] ?? "", "", frame),
  ]);
};

const buildFinalPerfectScoreHeaderFrame = (
  score: number,
  label: string,
  frame: number,
  projectName?: string,
): string => {
  const rawFaceLines = buildRawFaceLines(score);
  const renderedFaceLines = buildFaceRenderedLines(score);
  const rainbowBarLine = colorizeRainbowText(
    buildRawScoreBar(score),
    frame,
    getRightColumnOffset(rawFaceLines[1] ?? ""),
  );
  return joinScoreHeaderFrame([
    buildScoreHeaderLine(
      renderedFaceLines[0] ?? "",
      buildScoreLine(score, score, label, projectName),
    ),
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
  projectName?: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const isPerfectScore = score === PERFECT_SCORE;

    for (let frame = 0; frame <= SCORE_HEADER_ANIMATION_FRAME_COUNT; frame += 1) {
      const progress = easeOutCubic(frame / SCORE_HEADER_ANIMATION_FRAME_COUNT);
      const animatedScore = Math.round(score * progress);
      if (isPerfectScore) {
        const cursorUp = frame === 0 ? "" : "\x1b[4A";
        yield* writeScoreHeaderLine(
          `${cursorUp}\r${buildRainbowScoreHeaderFrame({
            score,
            displayScore: animatedScore,
            label,
            frame,
            projectName,
          })}`,
        );
        if (frame < SCORE_HEADER_ANIMATION_FRAME_COUNT) {
          yield* sleep(SCORE_HEADER_ANIMATION_FRAME_DELAY_MS);
        }
        continue;
      }

      const animatedScoreLine = buildScoreLine(animatedScore, score, label, projectName);
      const animatedBarLine = buildScoreBar(animatedScore, score);
      // HACK: \x1b[2A moves cursor up 2 lines to overwrite both the
      // score number line and the bar line in place each frame.
      const cursorUp = frame === 0 ? "" : "\x1b[2A";
      yield* writeScoreHeaderLine(
        `${cursorUp}\r${buildScoreHeaderLine(scoreFaceLine, animatedScoreLine)}\n\r${buildScoreHeaderLine(barFaceLine, animatedBarLine)}\n`,
      );
      if (frame < SCORE_HEADER_ANIMATION_FRAME_COUNT) {
        yield* sleep(SCORE_HEADER_ANIMATION_FRAME_DELAY_MS);
      }
    }

    if (!isPerfectScore) return;

    for (let frame = 0; frame < PERFECT_SCORE_RAINBOW_FRAME_COUNT; frame += 1) {
      yield* writeScoreHeaderLine(
        `\x1b[4A\r${buildRainbowScoreHeaderFrame({
          score,
          displayScore: score,
          label,
          frame,
          projectName,
        })}`,
      );
      yield* sleep(PERFECT_SCORE_RAINBOW_FRAME_DELAY_MS);
    }

    yield* writeScoreHeaderLine(
      `\x1b[4A\r${buildFinalPerfectScoreHeaderFrame(score, label, PERFECT_SCORE_RAINBOW_FRAME_COUNT, projectName)}\x1b[2A`,
    );
  });

export const printScoreHeader = (
  scoreResult: ScoreResult,
  projectName?: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const isPerfectScore = scoreResult.score === PERFECT_SCORE;
    const renderedFaceLines = buildFaceRenderedLines(scoreResult.score);
    const rawFaceLines = buildRawFaceLines(scoreResult.score);
    const shouldAnimate = !isSpinnerSilent() && isSpinnerInteractive(process.stdout);

    const displayScore = shouldAnimate ? 0 : scoreResult.score;
    const scoreLine = buildScoreLine(
      displayScore,
      scoreResult.score,
      scoreResult.label,
      projectName,
    );
    const scoreBarLine = shouldAnimate
      ? buildScoreBar(0, scoreResult.score)
      : buildScoreBar(scoreResult.score);

    const rightColumnLines = [scoreLine, scoreBarLine, BRANDING_LINE, ""];
    const rawRightColumnLines = [
      buildRawScoreLine(displayScore, scoreResult.label, projectName),
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
      yield* writeScoreHeaderLine("\x1b[5A");
      yield* printAnimatedScore(
        renderedFaceLines[0],
        renderedFaceLines[1],
        scoreResult.score,
        scoreResult.label,
        projectName,
      );
      yield* writeScoreHeaderLine("\x1b[3B");
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
