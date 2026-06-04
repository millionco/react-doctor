import * as Effect from "effect/Effect";
import { highlighter } from "@react-doctor/core";
import {
  WELCOME_EXPLANATION_HOLD_MS,
  WELCOME_INTER_LINE_DELAY_MS,
  WELCOME_TYPEWRITER_CHAR_DELAY_MS,
} from "./constants.js";
import { writeStdout } from "./write-stdout.js";

const HAPPY_FACE_LINES = ["┌─────┐", "│ ◠ ◠ │", "│  ▽  │", "└─────┘"] as const;

// Scales every welcome-scene delay down by this factor on returning runs
// (`hasCompletedOnboarding()` === true), so a user who's already seen the
// intro gets a snappier replay rather than the full first-run cadence.
// Tuned to feel quicker without making the tagline unreadable in one beat.
export const RETURNING_USER_SPEED_MULTIPLIER = 2;

export interface WelcomeSceneOptions {
  // Divides every typewriter and hold delay. Defaults to 1 (full first-run
  // cadence); use `RETURNING_USER_SPEED_MULTIPLIER` for a returning user.
  readonly speedMultiplier?: number;
}

// Types `text` in one char at a time, each step rewriting from column 0 and
// clearing to end of line so it also overwrites any longer text already there.
const typeLine = (
  linePrefix: string,
  text: string,
  style: (fragment: string) => string,
  charDelayMs: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const characters = [...text];
    for (let length = 1; length <= characters.length; length += 1) {
      yield* writeStdout(`\r${linePrefix}${style(characters.slice(0, length).join(""))}\x1b[K`);
      yield* Effect.sleep(charDelayMs);
    }
  });

// First-run greeting: the doctor face draws in, the welcome + tagline type beside
// it, then the block is wiped for the scan. Caller guarantees a TTY.
export const playWelcomeScene = (options: WelcomeSceneOptions = {}): Effect.Effect<void> =>
  Effect.gen(function* () {
    const speedMultiplier = options.speedMultiplier ?? 1;
    const charDelayMs = WELCOME_TYPEWRITER_CHAR_DELAY_MS / speedMultiplier;
    const interLineDelayMs = WELCOME_INTER_LINE_DELAY_MS / speedMultiplier;
    const explanationHoldMs = WELCOME_EXPLANATION_HOLD_MS / speedMultiplier;

    const face = HAPPY_FACE_LINES.map((line) => highlighter.success(line));
    const mouthPrefix = `  ${face[2] ?? ""}  `;

    // Blank line + face box; cursor ends just below the box.
    yield* writeStdout(`\n${face.map((line) => `  ${line}`).join("\n")}\n`);

    // Up to the eyes row; type the greeting.
    yield* writeStdout("\x1b[3A");
    yield* typeLine(
      `  ${face[1] ?? ""}  `,
      "Welcome to React Doctor",
      (fragment) => highlighter.bold(fragment),
      charDelayMs,
    );

    // Down to the mouth row; type the tagline.
    yield* Effect.sleep(interLineDelayMs);
    yield* writeStdout("\x1b[1B");
    yield* typeLine(
      mouthPrefix,
      "I diagnose your React code for bugs, security & performance.",
      (fragment) => highlighter.dim(fragment),
      charDelayMs,
    );

    // Hold so the tagline stays on screen long enough to read, then erase
    // the block: up to the leading blank, clear to end of screen.
    yield* Effect.sleep(explanationHoldMs);
    yield* writeStdout("\x1b[3A\r\x1b[0J");
  });
