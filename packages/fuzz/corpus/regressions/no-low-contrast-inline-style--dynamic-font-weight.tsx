// rule: no-low-contrast-inline-style
// weakness: value-provenance
// source: PR #850 Cursor Bugbot review

interface DynamicWeightTextProps {
  fontWeight: number;
}

export const DynamicWeightText = ({ fontWeight }: DynamicWeightTextProps) => (
  <span style={{ color: "#808080", backgroundColor: "#fff", fontSize: 20, fontWeight }}>
    Dynamic weight
  </span>
);
