import { FONT_FAMILY, GREEN_COLOR, WHITE_COLOR } from "../constants";
import { easeOutCubic } from "../utils/ease-out-cubic";
import { interpolateNumber } from "../utils/interpolate-number";
import {
  THREE_CLAUDE_ACCENT_COLOR,
  THREE_CLAUDE_BACKGROUND_COLOR,
  THREE_CLAUDE_FIX_FADE_FRAMES,
  THREE_CLAUDE_FIX_ROW_HEIGHT_PX,
  THREE_CLAUDE_FIX_START_FRAME,
  THREE_CLAUDE_FIX_STAGGER_FRAMES,
  THREE_CLAUDE_FIXES,
  THREE_CLAUDE_FONT_SIZE_PX,
  THREE_CLAUDE_INTRO_FRAMES,
  THREE_CLAUDE_LOGO_LINE_1,
  THREE_CLAUDE_LOGO_LINE_2,
  THREE_CLAUDE_LOGO_LINE_3,
  THREE_CLAUDE_MUTED_COLOR,
  THREE_CLAUDE_PROMPT,
  THREE_CLAUDE_SCORE_END,
  THREE_CLAUDE_SCORE_START,
  THREE_CLAUDE_TEXT_COLOR,
  THREE_CLAUDE_TYPING_CHAR_FRAMES,
  THREE_CLAUDE_TYPING_START_FRAME,
  THREE_CLAUDE_VISIBLE_FIX_ROWS,
} from "../three-constants";

const LAST_FIX_FRAME =
  THREE_CLAUDE_FIX_START_FRAME + (THREE_CLAUDE_FIXES.length - 1) * THREE_CLAUDE_FIX_STAGGER_FRAMES;
const TYPING_END_FRAME =
  THREE_CLAUDE_TYPING_START_FRAME + THREE_CLAUDE_PROMPT.length * THREE_CLAUDE_TYPING_CHAR_FRAMES;
const SCROLL_START_FRAME =
  THREE_CLAUDE_FIX_START_FRAME + THREE_CLAUDE_VISIBLE_FIX_ROWS * THREE_CLAUDE_FIX_STAGGER_FRAMES;
const VIEWPORT_HEIGHT_PX = THREE_CLAUDE_VISIBLE_FIX_ROWS * THREE_CLAUDE_FIX_ROW_HEIGHT_PX;
const MAX_SCROLL_PX = Math.max(
  0,
  THREE_CLAUDE_FIXES.length * THREE_CLAUDE_FIX_ROW_HEIGHT_PX - VIEWPORT_HEIGHT_PX,
);

const FixCheck = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      width: THREE_CLAUDE_FONT_SIZE_PX,
      height: THREE_CLAUDE_FONT_SIZE_PX,
      flexShrink: 0,
    }}
    aria-hidden="true"
  >
    <path
      d="M5 12 L10 17 L19 8"
      stroke={GREEN_COLOR}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export interface ThreeClaudeCodeProps {
  localFrame: number;
  opacity: number;
}

export const ThreeClaudeCode = ({ localFrame: rawLocalFrame, opacity }: ThreeClaudeCodeProps) => {
  const localFrame = Math.max(0, rawLocalFrame);
  const introOpacity = interpolateNumber({
    value: localFrame,
    inputStart: 0,
    inputEnd: THREE_CLAUDE_INTRO_FRAMES,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });

  const typedCharacterCount = Math.min(
    THREE_CLAUDE_PROMPT.length,
    Math.max(
      0,
      Math.floor((localFrame - THREE_CLAUDE_TYPING_START_FRAME) / THREE_CLAUDE_TYPING_CHAR_FRAMES),
    ),
  );
  const typedPrompt = THREE_CLAUDE_PROMPT.slice(0, typedCharacterCount);
  const isTypingDone = typedCharacterCount >= THREE_CLAUDE_PROMPT.length;
  const isCursorVisible = !isTypingDone || Math.floor(localFrame / 8) % 2 === 0;

  const statusOpacity = interpolateNumber({
    value: localFrame,
    inputStart: TYPING_END_FRAME + 2,
    inputEnd: TYPING_END_FRAME + 8,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });

  const fixedCount = THREE_CLAUDE_FIXES.filter(
    (_, fixIndex) =>
      localFrame >= THREE_CLAUDE_FIX_START_FRAME + fixIndex * THREE_CLAUDE_FIX_STAGGER_FRAMES,
  ).length;
  const allFixed = localFrame >= LAST_FIX_FRAME + THREE_CLAUDE_FIX_FADE_FRAMES;

  const scrollOffsetPx = interpolateNumber({
    value: localFrame,
    inputStart: SCROLL_START_FRAME,
    inputEnd: LAST_FIX_FRAME,
    outputStart: 0,
    outputEnd: MAX_SCROLL_PX,
  });

  const score = Math.round(
    interpolateNumber({
      value: localFrame,
      inputStart: THREE_CLAUDE_FIX_START_FRAME,
      inputEnd: LAST_FIX_FRAME,
      outputStart: THREE_CLAUDE_SCORE_START,
      outputEnd: THREE_CLAUDE_SCORE_END,
      easing: easeOutCubic,
    }),
  );

  const dotCount = (Math.floor(localFrame / 6) % 3) + 1;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 6,
        backgroundColor: THREE_CLAUDE_BACKGROUND_COLOR,
        fontFamily: FONT_FAMILY,
        fontSize: THREE_CLAUDE_FONT_SIZE_PX,
        color: THREE_CLAUDE_TEXT_COLOR,
        padding: "72px 90px",
        opacity,
      }}
    >
      <div style={{ opacity: introOpacity, lineHeight: 1.35, whiteSpace: "pre", marginBottom: 28 }}>
        <div>
          <span style={{ color: THREE_CLAUDE_ACCENT_COLOR }}>{THREE_CLAUDE_LOGO_LINE_1}</span>
          <span style={{ color: WHITE_COLOR }}>{"  Claude Code"}</span>
        </div>
        <div>
          <span style={{ color: THREE_CLAUDE_ACCENT_COLOR }}>{THREE_CLAUDE_LOGO_LINE_2}</span>
          <span style={{ color: THREE_CLAUDE_MUTED_COLOR }}>{"  Opus 4.6 · Claude API"}</span>
        </div>
        <div>
          <span style={{ color: THREE_CLAUDE_ACCENT_COLOR }}>{THREE_CLAUDE_LOGO_LINE_3}</span>
          <span style={{ color: THREE_CLAUDE_MUTED_COLOR }}>{"   ~/my-3d-app"}</span>
        </div>
      </div>

      <div style={{ opacity: introOpacity, marginBottom: 22, whiteSpace: "pre" }}>
        <span style={{ color: THREE_CLAUDE_ACCENT_COLOR }}>{"> "}</span>
        <span style={{ color: WHITE_COLOR }}>{typedPrompt}</span>
        <span
          style={{
            display: "inline-block",
            width: THREE_CLAUDE_FONT_SIZE_PX * 0.55,
            height: THREE_CLAUDE_FONT_SIZE_PX * 1.05,
            verticalAlign: "text-bottom",
            backgroundColor: isCursorVisible ? THREE_CLAUDE_TEXT_COLOR : "transparent",
          }}
        />
      </div>

      <div style={{ marginBottom: 26, opacity: statusOpacity }}>
        {allFixed ? (
          <span style={{ color: GREEN_COLOR }}>
            {`All ${THREE_CLAUDE_FIXES.length} issues fixed · score ${THREE_CLAUDE_SCORE_START} → ${score}`}
          </span>
        ) : (
          <span style={{ color: THREE_CLAUDE_ACCENT_COLOR }}>
            {`Fixing issues${".".repeat(dotCount)}`}
            <span style={{ color: THREE_CLAUDE_MUTED_COLOR }}>
              {`  ${fixedCount}/${THREE_CLAUDE_FIXES.length} · score ${score}`}
            </span>
          </span>
        )}
      </div>

      <div style={{ position: "relative", height: VIEWPORT_HEIGHT_PX, overflow: "hidden" }}>
        <div style={{ transform: `translateY(-${scrollOffsetPx}px)` }}>
          {THREE_CLAUDE_FIXES.map((fix, fixIndex) => {
            const fixFrame =
              THREE_CLAUDE_FIX_START_FRAME + fixIndex * THREE_CLAUDE_FIX_STAGGER_FRAMES;
            const rowOpacity = interpolateNumber({
              value: localFrame,
              inputStart: fixFrame,
              inputEnd: fixFrame + THREE_CLAUDE_FIX_FADE_FRAMES,
              outputStart: 0,
              outputEnd: 1,
            });
            return (
              <div
                key={fix.path + fix.note}
                style={{
                  height: THREE_CLAUDE_FIX_ROW_HEIGHT_PX,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  opacity: rowOpacity,
                  whiteSpace: "pre",
                }}
              >
                <FixCheck />
                <span style={{ color: WHITE_COLOR }}>{fix.path}</span>
                <span style={{ color: THREE_CLAUDE_MUTED_COLOR }}>{fix.note}</span>
              </div>
            );
          })}
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 80,
            background: `linear-gradient(to top, ${THREE_CLAUDE_BACKGROUND_COLOR}, transparent)`,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
};
