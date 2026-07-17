// rule: no-low-contrast-inline-style
// weakness: overwritten-object-property
// source: PR #850 Cursor Bugbot review
// oxlint-disable no-dupe-keys -- regression seed for ordered overrides

export const DynamicText = ({ textColor }: { textColor: string }) => (
  <span
    style={{
      color: "#9ca3af",
      color: textColor,
      backgroundColor: "#fff",
      fontSize: 16,
    }}
  >
    Dynamic text
  </span>
);
