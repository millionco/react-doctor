#!/usr/bin/env node

const PERFECT_SCORE = 100;
const SCORE_BAR_WIDTH_CHARS = 50;
const SCORE_BAR_ANIMATION_FRAME_COUNT = 40;
const SCORE_BAR_ANIMATION_FRAME_DELAY_MS = 50;
const PERFECT_SCORE_RAINBOW_FRAME_COUNT = 16;
const PERFECT_SCORE_RAINBOW_FRAME_DELAY_MS = 50;
const RAINBOW_HUE_SHIFT_PER_FRAME = 9;
const RAINBOW_GRADIENT_WIDTH = 80;
const RAINBOW_OKLCH_LIGHTNESS = 0.638;
const RAINBOW_OKLCH_CHROMA = 0.129;

const colors = {
  green: (text) => `\x1b[32m${text}\x1b[39m`,
  dim: (text) => `\x1b[2m${text}\x1b[22m`,
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const easeOutCubic = (progress) => 1 - (1 - progress) ** 3;

const clampColorChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));

const encodeSrgb = (value) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

const oklchToRgb = (lightness, chroma, hue) => {
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
      encodeSrgb(
        -1.2684380046 * longCone + 2.6097574011 * mediumCone - 0.3413193965 * shortCone,
      ) * 255,
    ),
    blue: clampColorChannel(
      encodeSrgb(-0.0041960863 * longCone - 0.7034186147 * mediumCone + 1.707614701 * shortCone) *
        255,
    ),
  };
};

const colorizeTrueColor = (text, { red, green, blue }) =>
  `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`;

const colorizeRainbowText = (text, frame) =>
  [...text]
    .map((character, index) => {
      if (character === " ") return character;
      const hue =
        ((index / RAINBOW_GRADIENT_WIDTH) * 360 + frame * RAINBOW_HUE_SHIFT_PER_FRAME) % 360;
      return colorizeTrueColor(
        character,
        oklchToRgb(RAINBOW_OKLCH_LIGHTNESS, RAINBOW_OKLCH_CHROMA, hue),
      );
    })
    .join("");

const buildScoreHeaderLine = (faceLine, rightColumnContent) => {
  const separator = rightColumnContent.length > 0 ? "  " : "";
  return `  ${faceLine}${separator}${rightColumnContent}`;
};

const getRightColumnOffset = (faceLine) => `  ${faceLine}  `.length;

const buildRainbowHeaderLine = (faceLine, rightColumnContent, frame) =>
  colorizeRainbowText(buildScoreHeaderLine(faceLine, rightColumnContent), frame);

const colorizeByScore = (text) => colors.green(text);

const buildScoreLine = (displayScore) =>
  `${colorizeByScore(`${displayScore}`)} ${colors.dim(`/ ${PERFECT_SCORE}`)} ${colorizeByScore("Perfect")}`;

const buildRawScoreLine = (displayScore) => `${displayScore} / ${PERFECT_SCORE} Perfect`;

const getFilledCount = (score) => Math.round((score / PERFECT_SCORE) * SCORE_BAR_WIDTH_CHARS);

const buildScoreBarSegments = (filledCount) => ({
  filledSegment: "█".repeat(filledCount),
  emptySegment: "░".repeat(SCORE_BAR_WIDTH_CHARS - filledCount),
});

const buildRawScoreBar = (displayScore) => {
  const { filledSegment, emptySegment } = buildScoreBarSegments(getFilledCount(displayScore));
  return filledSegment + emptySegment;
};

const rawFaceLines = ["┌─────┐", "│ ◠ ◠ │", "│  ▽  │", "└─────┘"];
const faceLines = rawFaceLines.map(colorizeByScore);
const rawBrandingLine = "React Doctor (https://react.doctor)";

const renderFullScoreFrame = ({ displayScore, frame, cursorUp }) => {
  process.stdout.write(
    `${cursorUp}\r${buildRainbowHeaderLine(rawFaceLines[0], buildRawScoreLine(displayScore), frame)}\n` +
      `\r${buildRainbowHeaderLine(rawFaceLines[1], buildRawScoreBar(displayScore), frame)}\n` +
      `\r${buildRainbowHeaderLine(rawFaceLines[2], rawBrandingLine, frame)}\n` +
      `\r${buildRainbowHeaderLine(rawFaceLines[3], "", frame)}\n`,
  );
};

const renderFinalScoreFrame = ({ frame, cursorUp }) => {
  const rainbowBarLine = colorizeRainbowText(
    buildRawScoreBar(PERFECT_SCORE),
    frame,
    getRightColumnOffset(rawFaceLines[1]),
  );
  process.stdout.write(
    `${cursorUp}\r${buildScoreHeaderLine(faceLines[0], buildScoreLine(PERFECT_SCORE))}\n` +
      `\r${buildScoreHeaderLine(faceLines[1], rainbowBarLine)}\n` +
      `\r${buildScoreHeaderLine(faceLines[2], `React Doctor ${colors.dim("(https://react.doctor)")}`)}\n` +
      `\r${buildScoreHeaderLine(faceLines[3], "")}\n`,
  );
};

const run = async () => {
  process.stdout.write("\x1b[?25l");

  try {
    process.stdout.write(`${buildRainbowHeaderLine(rawFaceLines[0], buildRawScoreLine(0), 0)}\n`);
    process.stdout.write(`${buildRainbowHeaderLine(rawFaceLines[1], buildRawScoreBar(0), 0)}\n`);
    process.stdout.write(`${buildRainbowHeaderLine(rawFaceLines[2], rawBrandingLine, 0)}\n`);
    process.stdout.write(`${buildRainbowHeaderLine(rawFaceLines[3], "", 0)}\n\n`);
    process.stdout.write("\x1b[5A");

    for (let frame = 0; frame <= SCORE_BAR_ANIMATION_FRAME_COUNT; frame += 1) {
      const progress = easeOutCubic(frame / SCORE_BAR_ANIMATION_FRAME_COUNT);
      const animatedScore = Math.round(PERFECT_SCORE * progress);
      renderFullScoreFrame({
        displayScore: animatedScore,
        frame,
        cursorUp: frame === 0 ? "" : "\x1b[4A",
      });
      if (frame < SCORE_BAR_ANIMATION_FRAME_COUNT) {
        await sleep(SCORE_BAR_ANIMATION_FRAME_DELAY_MS);
      }
    }

    for (let frame = 0; frame < PERFECT_SCORE_RAINBOW_FRAME_COUNT; frame += 1) {
      renderFullScoreFrame({
        displayScore: PERFECT_SCORE,
        frame,
        cursorUp: "\x1b[4A",
      });
      await sleep(PERFECT_SCORE_RAINBOW_FRAME_DELAY_MS);
    }

    renderFinalScoreFrame({
      frame: PERFECT_SCORE_RAINBOW_FRAME_COUNT,
      cursorUp: "\x1b[4A",
    });
    process.stdout.write("\x1b[2A");
    process.stdout.write("\x1b[3B");
  } finally {
    process.stdout.write("\x1b[?25h");
  }
};

await run();
