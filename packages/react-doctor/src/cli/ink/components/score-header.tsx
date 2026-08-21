import { Box, Text, useStdout } from "ink";
import { PERFECT_SCORE, SCORE_BAR_WIDTH_CHARS } from "@react-doctor/core";
import type { ScoreResult } from "@react-doctor/core";
import { doctorFace } from "../../utils/doctor-face.js";
import {
  SCORE_BAR_MIN_WIDTH_CHARS,
  TUI_HORIZONTAL_PADDING_COLUMNS,
  TUI_SCORE_FACE_WIDTH_COLUMNS,
  TUI_SCORE_FACE_OFFSET_COLUMNS,
  TUI_SCORE_RIGHT_EDGE_SAFETY_COLUMNS,
} from "../../utils/constants.js";
import { canAnimateOnboarding } from "../../utils/onboarding-pacing.js";
import { pluralize } from "../../utils/pluralize.js";
import { useAnimatedScore } from "../hooks/use-animated-score.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { scoreColorName } from "../lib/score-color.js";
import { TuiLink } from "./tui-link.js";

export interface ScoreHeaderProps {
  readonly variant: "landing" | "viewer";
  readonly score: ScoreResult | null;
  readonly projectedScore: number | null;
  readonly projectName: string;
  readonly issueCount: number;
  readonly noScoreMessage?: string;
  readonly width?: number;
}

const REACT_DOCTOR_URL = "https://react.doctor";
const ReactDoctorLink = () => (
  <TuiLink url={REACT_DOCTOR_URL}>
    React Doctor <Text dimColor>({REACT_DOCTOR_URL})</Text>
  </TuiLink>
);

export const ScoreHeader = ({
  variant,
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
  const shouldAnimateScore = canAnimateOnboarding(stdout ?? undefined);
  const visibleProjectedScore = variant === "landing" ? projectedScore : null;
  const { displayScore, displayProjectedScore } = useAnimatedScore({
    score: score?.score ?? 0,
    projectedScore: visibleProjectedScore,
    shouldAnimate: variant === "landing" && shouldAnimateScore && score !== null,
  });

  if (!score) {
    return (
      <Box
        flexDirection="column"
        paddingLeft={TUI_HORIZONTAL_PADDING_COLUMNS}
        width={availableWidth}
      >
        <Text wrap="truncate-end">
          <ReactDoctorLink />
        </Text>
        <Text dimColor wrap="wrap">
          {noScoreMessage ?? `${pluralize(issueCount, "finding")} · ${projectName}`}
        </Text>
      </Box>
    );
  }

  const scoreColor = scoreColorName(score.score);
  const scoreSummaryLine = (
    <Text wrap="truncate-end">
      <Text color={scoreColor} bold>
        {displayScore}
      </Text>
      <Text dimColor> / {PERFECT_SCORE} </Text>
      <Text color={scoreColor}>{score.label}</Text>
      <Text dimColor>
        {"  ·  "}
        {projectName}
      </Text>
    </Text>
  );
  const minimumWidthWithFace =
    TUI_SCORE_FACE_OFFSET_COLUMNS + SCORE_BAR_MIN_WIDTH_CHARS + TUI_SCORE_RIGHT_EDGE_SAFETY_COLUMNS;
  if (availableWidth < minimumWidthWithFace) {
    return (
      <Box flexDirection="column" width={availableWidth}>
        {scoreSummaryLine}
        <Text wrap="truncate-end">
          <ReactDoctorLink />
        </Text>
      </Box>
    );
  }

  const barWidth = Math.max(
    SCORE_BAR_MIN_WIDTH_CHARS,
    Math.min(
      SCORE_BAR_WIDTH_CHARS,
      availableWidth - TUI_SCORE_FACE_OFFSET_COLUMNS - TUI_SCORE_RIGHT_EDGE_SAFETY_COLUMNS,
    ),
  );
  const filledBarWidth = Math.round((displayScore / PERFECT_SCORE) * barWidth);
  const projectedBarWidth =
    displayProjectedScore != null
      ? Math.min(barWidth, Math.round((displayProjectedScore / PERFECT_SCORE) * barWidth))
      : filledBarWidth;
  const projectedGainWidth = Math.max(0, projectedBarWidth - filledBarWidth);
  const emptyBarWidth = Math.max(0, barWidth - filledBarWidth - projectedGainWidth);
  const [eyes, mouth] = doctorFace(score.score);

  return (
    <Box flexDirection="column" width={availableWidth}>
      <Box paddingLeft={TUI_HORIZONTAL_PADDING_COLUMNS} width={availableWidth}>
        <Box
          flexDirection="column"
          flexShrink={0}
          width={TUI_SCORE_FACE_WIDTH_COLUMNS}
          marginRight={TUI_HORIZONTAL_PADDING_COLUMNS}
        >
          <Text color={scoreColor}>{`┌─────┐\n│ ${eyes} │\n│ ${mouth} │\n└─────┘`}</Text>
        </Box>
        <Box flexDirection="column" width={availableWidth - TUI_SCORE_FACE_OFFSET_COLUMNS}>
          {scoreSummaryLine}
          <Text wrap="truncate-end">
            <Text color={scoreColor}>{"█".repeat(filledBarWidth)}</Text>
            <Text color={scoreColor} dimColor>
              {"▓".repeat(projectedGainWidth)}
            </Text>
            <Text dimColor>{"░".repeat(emptyBarWidth)}</Text>
          </Text>
          <Text wrap="truncate-end">
            <ReactDoctorLink />
          </Text>
          <Text> </Text>
        </Box>
      </Box>
      {variant === "landing" && projectedScore != null && projectedScore > score.score ? (
        <Text wrap="truncate-end">
          <Text dimColor>{"  Potential score "}</Text>
          <Text color={scoreColorName(projectedScore)}>{projectedScore}</Text>
          <Text dimColor> after priority fixes </Text>
          <Text color={scoreColorName(projectedScore)}>+{projectedScore - score.score}</Text>
        </Text>
      ) : null}
    </Box>
  );
};
