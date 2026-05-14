import {
  PERFECT_SCORE,
  SCORE_BAR_WIDTH_CHARS,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
} from "../constants.js";
import type { ScoreResult } from "../types/score.js";
import { colorizeByScore } from "./colorize-by-score.js";
import { highlighter } from "../core/highlighter.js";
import { logger } from "../core/logger.js";

interface ScoreBarSegments {
  filledSegment: string;
  emptySegment: string;
}

const buildScoreBarSegments = (score: number): ScoreBarSegments => {
  const filledCount = Math.round((score / PERFECT_SCORE) * SCORE_BAR_WIDTH_CHARS);
  const emptyCount = SCORE_BAR_WIDTH_CHARS - filledCount;

  return {
    filledSegment: "█".repeat(filledCount),
    emptySegment: "░".repeat(emptyCount),
  };
};

const buildScoreBar = (score: number): string => {
  const { filledSegment, emptySegment } = buildScoreBarSegments(score);
  return colorizeByScore(filledSegment, score) + highlighter.dim(emptySegment);
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

export const printScoreHeader = (scoreResult: ScoreResult): void => {
  const renderedFaceLines = buildFaceRenderedLines(scoreResult.score);

  const scoreNumber = colorizeByScore(`${scoreResult.score}`, scoreResult.score);
  const scoreLabel = colorizeByScore(scoreResult.label, scoreResult.score);
  const scoreLine = `${scoreNumber} ${highlighter.dim(`/ ${PERFECT_SCORE}`)} ${scoreLabel}`;
  const scoreBarLine = buildScoreBar(scoreResult.score);

  const rightColumnLines = [scoreLine, scoreBarLine, BRANDING_LINE, ""];

  for (let lineIndex = 0; lineIndex < renderedFaceLines.length; lineIndex += 1) {
    const rightColumnContent = rightColumnLines[lineIndex] ?? "";
    const separator = rightColumnContent.length > 0 ? "  " : "";
    logger.log(`  ${renderedFaceLines[lineIndex]}${separator}${rightColumnContent}`);
  }

  logger.break();
};

export const printBrandingOnlyHeader = (): void => {
  logger.log(`  ${BRANDING_LINE}`);
  logger.break();
};

export const printNoScoreHeader = (noScoreMessage: string): void => {
  logger.log(`  ${BRANDING_LINE}`);
  logger.log(`  ${highlighter.gray(noScoreMessage)}`);
  logger.break();
};
