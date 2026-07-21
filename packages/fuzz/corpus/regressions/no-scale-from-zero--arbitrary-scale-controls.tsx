// rule: no-scale-from-zero
// weakness: arbitrary-value-tokenization
// source: final adversarial review
// verdict: pass

const safeStyle = { transform: "none" };

export const StableScales = () => (
  <>
    <div className="scale-[0_1] transition-transform" />
    <div className="[transform:scale(.5)] transition-transform" />
    <div className="[transform:translateX(0)] transition-transform" />
    <div className="scale-0 transition-transform" style={safeStyle} />
  </>
);
