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
import { isSpinnerInteractive } from "./is-spinner-interactive.js";
import { isSpinnerSilent } from "./spinner.js";

const SCORE_BAR_ANIMATION_FRAME_COUNT = 40;
const SCORE_BAR_ANIMATION_FRAME_DELAY_MS = 50;

interface ScoreBarSegments {
  filledSegment: string;
  emptySegment: string;
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

const buildFaceRenderedLines = (score: number): string[] => {
  const [eyes, mouth] = getDoctorFace(score);
  const colorize = (text: string) => colorizeByScore(text, score);
  return ["┌─────┐", `│ ${eyes} │`, `│ ${mouth} │`, "└─────┘"].map(colorize);
};

const buildScoreHeaderLine = (faceLine: string, rightColumnContent: string): string => {
  const separator = rightColumnContent.length > 0 ? "  " : "";
  return `  ${faceLine}${separator}${rightColumnContent}`;
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

const printAnimatedScore = (
  scoreFaceLine: string,
  barFaceLine: string,
  score: number,
  label: string,
  projectName?: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let frame = 0; frame <= SCORE_BAR_ANIMATION_FRAME_COUNT; frame += 1) {
      const progress = easeOutCubic(frame / SCORE_BAR_ANIMATION_FRAME_COUNT);
      const animatedScore = Math.round(score * progress);
      const animatedScoreLine = buildScoreLine(animatedScore, score, label, projectName);
      const animatedBarLine = buildScoreBar(animatedScore, score);
      // HACK: \x1b[2A moves cursor up 2 lines to overwrite both the
      // score number line and the bar line in place each frame.
      const cursorUp = frame === 0 ? "" : "\x1b[2A";
      yield* writeScoreHeaderLine(
        `${cursorUp}\r${buildScoreHeaderLine(scoreFaceLine, animatedScoreLine)}\n\r${buildScoreHeaderLine(barFaceLine, animatedBarLine)}\n`,
      );
      if (frame < SCORE_BAR_ANIMATION_FRAME_COUNT) {
        yield* sleep(SCORE_BAR_ANIMATION_FRAME_DELAY_MS);
      }
    }
  });

export const printScoreHeader = (
  scoreResult: ScoreResult,
  projectName?: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const renderedFaceLines = buildFaceRenderedLines(scoreResult.score);
    const shouldAnimate = !isSpinnerSilent() && isSpinnerInteractive(process.stdout);

    const scoreLine = buildScoreLine(
      shouldAnimate ? 0 : scoreResult.score,
      scoreResult.score,
      scoreResult.label,
      projectName,
    );
    const scoreBarLine = shouldAnimate
      ? buildScoreBar(0, scoreResult.score)
      : buildScoreBar(scoreResult.score);

    const rightColumnLines = [scoreLine, scoreBarLine, BRANDING_LINE, ""];

    for (let lineIndex = 0; lineIndex < renderedFaceLines.length; lineIndex += 1) {
      const rightColumnContent = rightColumnLines[lineIndex] ?? "";
      yield* Console.log(buildScoreHeaderLine(renderedFaceLines[lineIndex], rightColumnContent));
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
