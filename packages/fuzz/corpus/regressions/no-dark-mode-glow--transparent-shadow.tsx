// rule: no-dark-mode-glow
// weakness: other
// source: ISSUES_TO_FIX_ASAP.md V28 alpha-zero shadow report

export const TransparentGlow = () => (
  <div
    style={{
      backgroundColor: "#000",
      boxShadow: "0 0 60px rgba(255, 0, 0, 0)",
    }}
  />
);
