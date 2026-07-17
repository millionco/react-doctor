// rule: no-low-contrast-inline-style
// weakness: color-syntax
// source: Bugbot review on PR #850

export const LowContrastHslText = () => (
  <span style={{ color: "hsl(220 9% 65%)", backgroundColor: "hsl(0 0% 100%)", fontSize: 16 }}>
    Account balance
  </span>
);

export const TransparentHslText = () => (
  <span style={{ color: "hsl(220 9% 65% / 40%)", backgroundColor: "hsl(0 0% 100%)", fontSize: 16 }}>
    Account balance
  </span>
);
