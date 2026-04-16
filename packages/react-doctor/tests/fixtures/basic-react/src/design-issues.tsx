const BounceEasingComponent = () => (
  <div style={{ transition: "transform 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55)" }}>bounce</div>
);

const BounceAnimationComponent = () => <div style={{ animationName: "bounce" }}>bounce</div>;

const AbsurdZIndexComponent = () => (
  <div style={{ zIndex: 9999, position: "relative" }}>on top</div>
);

const InlineStyleOverloadComponent = () => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
      margin: "8px",
      backgroundColor: "#f0f0f0",
      borderRadius: "8px",
      border: "1px solid #ccc",
      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
    }}
  >
    too many inline styles
  </div>
);

const CleanComponent = () => <div style={{ display: "flex", gap: "8px" }}>clean</div>;

const ReasonableZIndexComponent = () => <div style={{ zIndex: 10 }}>reasonable</div>;

const SmoothEasingComponent = () => (
  <div style={{ transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}>smooth</div>
);

export {
  BounceEasingComponent,
  BounceAnimationComponent,
  AbsurdZIndexComponent,
  InlineStyleOverloadComponent,
  CleanComponent,
  ReasonableZIndexComponent,
  SmoothEasingComponent,
};
