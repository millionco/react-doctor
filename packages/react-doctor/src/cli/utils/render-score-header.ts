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

const SCORE_BAR_ANIMATION_FRAME_COUNT = 12;
const SCORE_BAR_ANIMATION_FRAME_DELAY_MS = 20;

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

const BRANDING_LINE = `React Doctor ${highlighter.dim("(www.react.doctor)")}`;

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

const printAnimatedScoreBarLine = (faceLine: string, score: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let frame = 0; frame <= SCORE_BAR_ANIMATION_FRAME_COUNT; frame += 1) {
      const progress = easeOutCubic(frame / SCORE_BAR_ANIMATION_FRAME_COUNT);
      const animatedScore = Math.round(score * progress);
      const scoreBarLine = buildScoreBar(animatedScore, score);
      yield* writeScoreHeaderLine(`\r${buildScoreHeaderLine(faceLine, scoreBarLine)}`);
      if (frame < SCORE_BAR_ANIMATION_FRAME_COUNT) {
        yield* sleep(SCORE_BAR_ANIMATION_FRAME_DELAY_MS);
      }
    }
    yield* writeScoreHeaderLine("\n");
  });

export const printScoreHeader = (scoreResult: ScoreResult): Effect.Effect<void> =>
  Effect.gen(function* () {
    const renderedFaceLines = buildFaceRenderedLines(scoreResult.score);

    const scoreNumber = colorizeByScore(`${scoreResult.score}`, scoreResult.score);
    const scoreLabel = colorizeByScore(scoreResult.label, scoreResult.score);
    const scoreLine = `${scoreNumber} ${highlighter.dim(`/ ${PERFECT_SCORE}`)} ${scoreLabel}`;
    const scoreBarLine = buildScoreBar(scoreResult.score);

    const rightColumnLines = [scoreLine, scoreBarLine, BRANDING_LINE, ""];

    for (let lineIndex = 0; lineIndex < renderedFaceLines.length; lineIndex += 1) {
      const rightColumnContent = rightColumnLines[lineIndex] ?? "";
      if (lineIndex === 1 && !isSpinnerSilent() && isSpinnerInteractive(process.stdout)) {
        yield* printAnimatedScoreBarLine(renderedFaceLines[lineIndex], scoreResult.score);
        continue;
      }
      yield* Console.log(buildScoreHeaderLine(renderedFaceLines[lineIndex], rightColumnContent));
    }

    yield* Console.log("");
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
