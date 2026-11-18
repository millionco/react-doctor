// rule: no-array-index-as-key
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic
import { styled } from "@mui/material";

interface TextRun {
  value: string;
}

interface TextRunsProps {
  rows: TextRun[];
}

const TextLeaf = styled("span")`
  color: navy;
`;

export const TextRuns = ({ rows }: TextRunsProps) => (
  <span>
    {rows.map((row, index) => (
      <TextLeaf key={index}>{row.value}</TextLeaf>
    ))}
  </span>
);
