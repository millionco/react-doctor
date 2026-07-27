import { m } from "framer-motion";
import {
  DIAGNOSE_SCENE_DURATION_FRAMES,
  SCORE_SCENE_START_FRAME,
  TERMINAL_SCENE_START_FRAME,
} from "../constants";
import { DiagnoseAndFix } from "../scenes/diagnose-and-fix";
import { ScoreReveal } from "../scenes/score-reveal";
import { TerminalTyping } from "../scenes/terminal-typing";

export interface ClaudeTimelineProps {
  frame: number;
}

export const ClaudeTimeline = ({ frame }: ClaudeTimelineProps) => (
  <>
    {frame < DIAGNOSE_SCENE_DURATION_FRAMES && (
      <m.div key="claude-diagnose" className="scene">
        <DiagnoseAndFix frame={frame} />
      </m.div>
    )}
    {frame >= SCORE_SCENE_START_FRAME && frame < TERMINAL_SCENE_START_FRAME && (
      <m.div key="claude-score" className="scene">
        <ScoreReveal frame={frame - SCORE_SCENE_START_FRAME} />
      </m.div>
    )}
    {frame >= TERMINAL_SCENE_START_FRAME && (
      <m.div key="claude-terminal" className="scene">
        <TerminalTyping frame={frame - TERMINAL_SCENE_START_FRAME} />
      </m.div>
    )}
  </>
);
