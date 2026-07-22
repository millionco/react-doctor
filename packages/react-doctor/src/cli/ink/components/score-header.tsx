import { Box, Text, useStdout } from "ink";
import { useMemo } from "react";
import { PERFECT_SCORE, SCORE_BAR_WIDTH_CHARS, TOP_ERRORS_DISPLAY_COUNT } from "@react-doctor/core";
import type { ScoreResult } from "@react-doctor/core";
import { doctorFace } from "../../utils/doctor-face.js";
import {
  TUI_HORIZONTAL_PADDING_COLUMNS,
  TUI_SCORE_FACE_OFFSET_COLUMNS,
  TUI_SCORE_RIGHT_EDGE_SAFETY_COLUMNS,
} from "../../utils/constants.js";
import { canAnimateOnboarding } from "../../utils/onboarding-pacing.js";
import { useAnimatedScore } from "../hooks/use-animated-score.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { scoreColorName } from "../lib/score-color.js";

export interface ScoreHeaderProps {
  readonly score: ScoreResult | null;
  readonly projectedScore: number | null;
  readonly projectName: string;
  readonly issueCount: number;
  readonly noScoreMessage?: string;
  readonly width?: number;
}

const BRANDING = "https://react.doctor";

export const ScoreHeader = ({
  score,
  projectedScore,
  projectName,
  issueCount,
  noScoreMessage,
  width,
}: ScoreHeaderProps) => {
  const { columns } = useStdoutDimensions();
  const availableWidth = width ?? columns;
  const { stdout } = useStdout();
  const animate = useMemo(() => canAnimateOnboarding(stdout ?? undefined), [stdout]);
  const { displayScore, displayProjectedScore } = useAnimatedScore({
    score: score?.score ?? 0,
    projectedScore,
    animate: animate && score !== null,
  });

  if (!score) {
    return (
      <Box flexDirection="column" paddingLeft={TUI_HORIZONTAL_PADDING_COLUMNS}>
        <Text>
          React Doctor <Text dimColor>({BRANDING})</Text>
        </Text>
        <Text dimColor>{noScoreMessage ?? `${issueCount} issues · ${projectName}`}</Text>
      </Box>
    );
  }

  const color = scoreColorName(score.score);
  const barWidth = Math.max(
    10,
    Math.min(
      SCORE_BAR_WIDTH_CHARS,
      availableWidth - TUI_SCORE_FACE_OFFSET_COLUMNS - TUI_SCORE_RIGHT_EDGE_SAFETY_COLUMNS,
    ),
  );
  const filled = Math.round((displayScore / PERFECT_SCORE) * barWidth);
  const projectedFill =
    displayProjectedScore != null
      ? Math.min(barWidth, Math.round((displayProjectedScore / PERFECT_SCORE) * barWidth))
      : filled;
  const gain = Math.max(0, projectedFill - filled);
  const empty = Math.max(0, barWidth - filled - gain);
  const [eyes, mouth] = doctorFace(score.score);

  return (
    <Box flexDirection="column">
      <Box paddingLeft={TUI_HORIZONTAL_PADDING_COLUMNS}>
        <Box flexDirection="column" marginRight={TUI_HORIZONTAL_PADDING_COLUMNS}>
          <Text color={color}>┌─────┐</Text>
          <Text color={color}>│ {eyes} │</Text>
          <Text color={color}>│ {mouth} │</Text>
          <Text color={color}>└─────┘</Text>
        </Box>
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={color} bold>
              {displayScore}
            </Text>
            <Text dimColor> / {PERFECT_SCORE} </Text>
            <Text color={color}>{score.label}</Text>
            <Text dimColor>
              {"  ·  "}
              {projectName}
            </Text>
          </Text>
          <Text wrap="truncate-end">
            <Text color={color}>{"█".repeat(filled)}</Text>
            <Text color={color} dimColor>
              {"▓".repeat(gain)}
            </Text>
            <Text dimColor>{"░".repeat(empty)}</Text>
          </Text>
          <Text>
            React Doctor <Text dimColor>({BRANDING})</Text>
          </Text>
          <Text> </Text>
        </Box>
      </Box>
      {projectedScore != null && projectedScore > score.score ? (
        <Text>
          <Text dimColor>{"  You could improve "}</Text>
          <Text color={scoreColorName(projectedScore)}>+{projectedScore - score.score}%</Text>
          <Text dimColor>{` by fixing the top ${TOP_ERRORS_DISPLAY_COUNT} issues`}</Text>
        </Text>
      ) : null}
    </Box>
  );
};
