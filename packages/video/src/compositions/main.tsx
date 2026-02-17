import { Series } from "remotion";
import {
  SCENE_DIAGNOSTICS_DURATION_FRAMES,
  SCENE_FILE_SCAN_DURATION_FRAMES,
  SCENE_TYPING_DURATION_FRAMES,
} from "../constants";
import { Diagnostics } from "../scenes/diagnostics";
import { FileScan } from "../scenes/file-scan";
import { TerminalTyping } from "../scenes/terminal-typing";

export const Main = () => {
  return (
    <Series>
      <Series.Sequence durationInFrames={SCENE_TYPING_DURATION_FRAMES}>
        <TerminalTyping />
      </Series.Sequence>

      <Series.Sequence durationInFrames={SCENE_FILE_SCAN_DURATION_FRAMES}>
        <FileScan />
      </Series.Sequence>

      <Series.Sequence durationInFrames={SCENE_DIAGNOSTICS_DURATION_FRAMES}>
        <Diagnostics />
      </Series.Sequence>
    </Series>
  );
};
