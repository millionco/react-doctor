// ── Bounce easing ──

const BounceEasingComponent = () => (
  <div style={{ transition: "transform 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55)" }}>bounce</div>
);

const BounceAnimationComponent = () => <div style={{ animationName: "bounce" }}>bounce</div>;

const SpringTimingComponent = () => (
  <div style={{ animationTimingFunction: "cubic-bezier(0.5, -0.5, 0.5, 1.5)" }}>spring</div>
);

const TailwindBounceComponent = () => <div className="animate-bounce text-lg">bouncing text</div>;

// ── z-index ──

const AbsurdZIndexComponent = () => (
  <div style={{ zIndex: 9999, position: "relative" }}>on top</div>
);

const AbsurdZIndexStringComponent = () => <div style={{ zIndex: 999 }}>also bad</div>;

// ── Exhaustive inline style ──

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

// ── Side-tab border ──

const SideTabInlineComponent = () => (
  <div style={{ borderLeft: "4px solid #7c3aed", borderRadius: "8px" }}>side tab</div>
);

const SideTabTailwindComponent = () => (
  <div className="border-l-4 rounded-lg p-4">side tab tailwind</div>
);

const SideTabWidthComponent = () => (
  <div style={{ borderLeftWidth: 5, borderLeftStyle: "solid", borderLeftColor: "#7c3aed" }}>
    side tab width
  </div>
);

// ── Pure black background ──

const PureBlackBgComponent = () => (
  <div style={{ backgroundColor: "#000000", color: "white" }}>pure black</div>
);

const PureBlackBgShortComponent = () => (
  <div style={{ backgroundColor: "#000" }}>short hex black</div>
);

const PureBlackTailwindComponent = () => <div className="bg-black text-white">tailwind black</div>;

// ── Gradient text ──

const GradientTextInlineComponent = () => (
  <div
    style={{
      backgroundImage: "linear-gradient(to right, #7c3aed, #db2777)",
      backgroundClip: "text",
      WebkitBackgroundClip: "text",
      color: "transparent",
    }}
  >
    gradient text
  </div>
);

const GradientTextTailwindComponent = () => (
  <h1 className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
    gradient heading
  </h1>
);

// ── Overused font ──

const InterFontComponent = () => <div style={{ fontFamily: "Inter, sans-serif" }}>inter text</div>;

const RobotoFontComponent = () => (
  <div style={{ fontFamily: "'Roboto', sans-serif" }}>roboto text</div>
);

// ── Dark mode glow ──

const DarkGlowComponent = () => (
  <div
    style={{
      backgroundColor: "#000",
      boxShadow: "0 0 20px rgba(124, 58, 237, 0.5)",
    }}
  >
    glowing card
  </div>
);

// ── Justified text ──

const JustifiedTextComponent = () => (
  <p style={{ textAlign: "justify" }}>
    This text is justified without hyphens, creating rivers of white space.
  </p>
);

const JustifiedWithHyphensComponent = () => (
  <p style={{ textAlign: "justify", hyphens: "auto" }}>
    This justified text has hyphens enabled, which is acceptable.
  </p>
);

// ── Tiny text ──

const TinyTextComponent = () => <p style={{ fontSize: "10px" }}>too small to read</p>;

const TinyTextNumberComponent = () => <span style={{ fontSize: 8 }}>extremely small</span>;

// ── Wide letter spacing ──

const WideTrackingComponent = () => (
  <p style={{ letterSpacing: "0.1em" }}>wide tracked body text</p>
);

const WideTrackingUppercaseOk = () => (
  <span style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>LABEL</span>
);

// ── Gray on colored background ──

const GrayOnColorComponent = () => (
  <div className="bg-blue-500 text-gray-400 p-4">washed out text</div>
);

const GrayOnColorSlateComponent = () => (
  <div className="bg-emerald-600 text-slate-400">also washed out</div>
);

// ── Layout transition ──

const LayoutTransitionComponent = () => (
  <div style={{ transition: "width 0.3s ease, opacity 0.3s ease" }}>transitioning width</div>
);

const HeightTransitionComponent = () => (
  <div style={{ transitionProperty: "height, transform" }}>transitioning height</div>
);

// ── Disabled zoom (viewport meta) ──

const DisabledZoomComponent = () => (
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
  </head>
);

const RestrictedZoomComponent = () => (
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  </head>
);

// ── px font size ──

const PxFontSizeComponent = () => <p style={{ fontSize: "14px" }}>px font size</p>;

const NumericFontSizeComponent = () => <span style={{ fontSize: 12 }}>unitless font size</span>;

// ── outline none ──

const OutlineNoneComponent = () => <button style={{ outline: "none" }}>no focus ring</button>;

const OutlineZeroComponent = () => <input style={{ outline: 0 }} />;

const OutlineNoneWithShadowOk = () => (
  <button style={{ outline: "none", boxShadow: "0 0 0 2px blue" }}>custom focus ring</button>
);

// ── Long transition duration ──

const SlowTransitionComponent = () => (
  <div style={{ transition: "opacity 1.5s ease" }}>too slow</div>
);

const SlowTransitionDurationComponent = () => (
  <div style={{ transitionDuration: "800ms" }}>also too slow</div>
);

// ── Google fonts link ──

const GoogleFontsLinkComponent = () => (
  <head>
    <link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet" />
  </head>
);

const GoogleFontsNoDisplayComponent = () => (
  <head>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk" rel="stylesheet" />
  </head>
);

// ── Clean components (should NOT trigger) ──

const CleanComponent = () => <div style={{ display: "flex", gap: "8px" }}>clean</div>;

const ReasonableZIndexComponent = () => <div style={{ zIndex: 10 }}>reasonable</div>;

const SmoothEasingComponent = () => (
  <div style={{ transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}>smooth</div>
);

const NormalBorderComponent = () => <div style={{ border: "1px solid #ccc" }}>normal border</div>;

const NearBlackComponent = () => (
  <div style={{ backgroundColor: "#0a0a0f" }}>near black, not pure</div>
);

const NormalFontComponent = () => (
  <div style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>distinctive font</div>
);

const RemFontSizeOk = () => <div style={{ fontSize: "1rem" }}>rem is fine</div>;

const OpacityTransitionComponent = () => (
  <div style={{ transition: "opacity 0.3s ease, transform 0.3s ease" }}>safe transition</div>
);

const NormalViewportComponent = () => (
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
);

const FastTransitionComponent = () => (
  <div style={{ transition: "transform 0.2s ease" }}>fast enough</div>
);

export {
  BounceEasingComponent,
  BounceAnimationComponent,
  SpringTimingComponent,
  TailwindBounceComponent,
  AbsurdZIndexComponent,
  AbsurdZIndexStringComponent,
  InlineStyleOverloadComponent,
  SideTabInlineComponent,
  SideTabTailwindComponent,
  SideTabWidthComponent,
  PureBlackBgComponent,
  PureBlackBgShortComponent,
  PureBlackTailwindComponent,
  GradientTextInlineComponent,
  GradientTextTailwindComponent,
  InterFontComponent,
  RobotoFontComponent,
  DarkGlowComponent,
  JustifiedTextComponent,
  JustifiedWithHyphensComponent,
  TinyTextComponent,
  TinyTextNumberComponent,
  WideTrackingComponent,
  WideTrackingUppercaseOk,
  GrayOnColorComponent,
  GrayOnColorSlateComponent,
  LayoutTransitionComponent,
  HeightTransitionComponent,
  DisabledZoomComponent,
  RestrictedZoomComponent,
  PxFontSizeComponent,
  NumericFontSizeComponent,
  OutlineNoneComponent,
  OutlineZeroComponent,
  OutlineNoneWithShadowOk,
  SlowTransitionComponent,
  SlowTransitionDurationComponent,
  GoogleFontsLinkComponent,
  GoogleFontsNoDisplayComponent,
  CleanComponent,
  ReasonableZIndexComponent,
  SmoothEasingComponent,
  NormalBorderComponent,
  NearBlackComponent,
  NormalFontComponent,
  RemFontSizeOk,
  OpacityTransitionComponent,
  NormalViewportComponent,
  FastTransitionComponent,
};
