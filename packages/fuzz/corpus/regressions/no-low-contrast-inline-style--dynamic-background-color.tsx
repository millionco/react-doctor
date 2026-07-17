// rule: no-low-contrast-inline-style
// weakness: other
// source: PR #850 Cursor Bugbot review

export const Label = ({ surfaceColor }: { surfaceColor: string }) => (
  <span
    style={{
      color: "#9ca3af",
      background: "#fff",
      backgroundColor: surfaceColor,
      fontSize: 16,
    }}
  >
    Balance
  </span>
);
