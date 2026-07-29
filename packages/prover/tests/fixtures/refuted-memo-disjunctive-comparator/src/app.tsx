import { memo } from "react";

interface ResultProperties {
  label: string;
  score: number;
}

const ResultView = ({ label, score }: ResultProperties) => (
  <output>
    {label}: {score}
  </output>
);

export const Result = memo(
  ResultView,
  (previousProperties, nextProperties) =>
    previousProperties.label === nextProperties.label ||
    previousProperties.score === nextProperties.score,
);
