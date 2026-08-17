import { GREEN_COLOR, WHITE_COLOR } from "../constants";
import { easeOutCubic } from "../utils/ease-out-cubic";
import { interpolateNumber } from "../utils/interpolate-number";
import {
  THREE_CLAUDE_ACCENT_COLOR,
  THREE_CLAUDE_FIX_FADE_FRAMES,
  THREE_CLAUDE_FIX_START_FRAME,
  THREE_CLAUDE_FIX_STAGGER_FRAMES,
  THREE_CLAUDE_FIXES,
  THREE_CLAUDE_INTRO_FRAMES,
  THREE_CLAUDE_PROMPT,
  THREE_CLAUDE_SCORE_END,
  THREE_CLAUDE_SCORE_START,
  THREE_CLAUDE_TYPING_CHAR_FRAMES,
  THREE_CLAUDE_TYPING_START_FRAME,
} from "../three-constants";

const LAST_FIX_FRAME =
  THREE_CLAUDE_FIX_START_FRAME + (THREE_CLAUDE_FIXES.length - 1) * THREE_CLAUDE_FIX_STAGGER_FRAMES;
const TYPING_END_FRAME =
  THREE_CLAUDE_TYPING_START_FRAME + THREE_CLAUDE_PROMPT.length * THREE_CLAUDE_TYPING_CHAR_FRAMES;

export interface ThreeClaudeCodeProps {
  localFrame: number;
  opacity: number;
}

export const ThreeClaudeCode = ({ localFrame: rawLocalFrame, opacity }: ThreeClaudeCodeProps) => {
  const localFrame = Math.max(0, rawLocalFrame);
  const cardOpacity = interpolateNumber({
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
    <section className="three-claude-layout" style={{ opacity }}>
      <div className="three-copy three-claude-copy">
        <div className="three-step-label">03 / IMPROVE-THREEJS</div>
        <h2>Your agent fixes what it finds.</h2>
        <div
          className="three-code-card"
          style={{
            borderColor: "rgba(215, 119, 87, 0.32)",
            opacity: cardOpacity,
            transform: `translateY(${(1 - cardOpacity) * 20}px)`,
          }}
        >
          <div className="three-code-card-header">
            <span>claude code</span>
            <span style={{ color: THREE_CLAUDE_ACCENT_COLOR }}>~/my-3d-app</span>
          </div>
          <div className="three-claude-body">
            <div className="three-claude-prompt">
              <span style={{ color: THREE_CLAUDE_ACCENT_COLOR }}>{"> "}</span>
              <span style={{ color: WHITE_COLOR }}>{typedPrompt}</span>
              <span
                className="three-claude-cursor"
                style={{
                  backgroundColor: isCursorVisible ? THREE_CLAUDE_ACCENT_COLOR : "transparent",
                }}
              />
            </div>
            <div className="three-claude-status" style={{ opacity: statusOpacity }}>
              {allFixed ? (
                <span style={{ color: GREEN_COLOR }}>
                  {`All ${THREE_CLAUDE_FIXES.length} issues fixed · score ${THREE_CLAUDE_SCORE_START} → ${score}`}
                </span>
              ) : (
                <span style={{ color: THREE_CLAUDE_ACCENT_COLOR }}>
                  {`Fixing issues${".".repeat(dotCount)}`}
                  <span className="three-claude-status-count">
                    {`  ${fixedCount}/${THREE_CLAUDE_FIXES.length} · score ${score}`}
                  </span>
                </span>
              )}
            </div>
            <div className="three-claude-fixes">
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
                    className="three-claude-fix-row"
                    style={{ opacity: rowOpacity }}
                  >
                    <span style={{ color: GREEN_COLOR }}>✓</span>
                    <span style={{ color: WHITE_COLOR }}>{fix.path}</span>
                    <span className="three-claude-fix-note">{fix.note}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
