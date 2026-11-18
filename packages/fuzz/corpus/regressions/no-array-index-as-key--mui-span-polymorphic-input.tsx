// rule: no-array-index-as-key
// verdict: fail
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

export const InteractiveRuns = ({ rows }: TextRunsProps) => (
  <span>
    {rows.map((row, index) => (
      // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- Intentional warning in a fuzz corpus example.
      <TextLeaf as="input" key={index} defaultValue={row.value} />
    ))}
  </span>
);
