const BounceEasingComponent = () => (
  <div style={{ transition: "transform 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55)" }}>bounce</div>
);

const BounceAnimationComponent = () => <div style={{ animationName: "bounce" }}>bounce</div>;

const SpringTimingComponent = () => (
  <div style={{ animationTimingFunction: "cubic-bezier(0.5, -0.5, 0.5, 1.5)" }}>spring</div>
);

const TailwindBounceComponent = () => <div className="animate-bounce text-lg">bouncing text</div>;

const AbsurdZIndexComponent = () => (
  <div style={{ zIndex: 9999, position: "relative" }}>on top</div>
);

const AbsurdZIndexStringComponent = () => <div style={{ zIndex: 999 }}>also bad</div>;

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

const SideTabInlineComponent = () => (
  <div style={{ borderLeft: "4px solid #7c3aed", borderRadius: "8px" }}>side tab</div>
);

const SideTabTailwindComponent = () => (
  <div className="border-l-4 rounded-lg p-4">side tab tailwind</div>
);

const PureBlackBgComponent = () => (
  <div style={{ backgroundColor: "#000000", color: "white" }}>pure black</div>
);

const PureBlackBgShortComponent = () => (
  <div style={{ backgroundColor: "#000" }}>short hex black</div>
);

const PureBlackTailwindComponent = () => <div className="bg-black text-white">tailwind black</div>;

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

const TinyTextComponent = () => <p style={{ fontSize: "10px" }}>too small to read</p>;

const TinyTextNumberComponent = () => <span style={{ fontSize: 8 }}>extremely small</span>;

const WideTrackingComponent = () => (
  <p style={{ letterSpacing: "0.1em" }}>wide tracked body text</p>
);

const WideTrackingUppercaseOk = () => (
  <span style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>LABEL</span>
);

const GrayOnColorComponent = () => (
  <div className="bg-blue-500 text-gray-400 p-4">washed out text</div>
);

const GrayOnColorSlateComponent = () => (
  <div className="bg-emerald-600 text-slate-400">also washed out</div>
);

const LayoutTransitionComponent = () => (
  <div style={{ transition: "width 0.3s ease, opacity 0.3s ease" }}>transitioning width</div>
);

const HeightTransitionComponent = () => (
  <div style={{ transitionProperty: "height, transform" }}>transitioning height</div>
);

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

const OutlineNoneComponent = () => <button style={{ outline: "none" }}>no focus ring</button>;

const OutlineZeroComponent = () => <input style={{ outline: 0 }} />;

const OutlineNoneWithShadowOk = () => (
  <button style={{ outline: "none", boxShadow: "0 0 0 2px blue" }}>custom focus ring</button>
);

const SlowTransitionComponent = () => (
  <div style={{ transition: "opacity 1.5s ease" }}>too slow</div>
);

const SlowTransitionDurationComponent = () => (
  <div style={{ transitionDuration: "1200ms" }}>also too slow</div>
);

const CleanComponent = () => <div style={{ display: "flex", gap: "8px" }}>clean</div>;

const ReasonableZIndexComponent = () => <div style={{ zIndex: 10 }}>reasonable</div>;

const SmoothEasingComponent = () => (
  <div style={{ transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}>smooth</div>
);

const NormalBorderComponent = () => <div style={{ border: "1px solid #ccc" }}>normal border</div>;

const NearBlackComponent = () => (
  <div style={{ backgroundColor: "#0a0a0f" }}>near black, not pure</div>
);

const OpacityTransitionComponent = () => (
  <div style={{ transition: "opacity 0.3s ease, transform 0.3s ease" }}>safe transition</div>
);

const NormalViewportComponent = () => (
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
);

const FastTransitionComponent = () => (
  <div style={{ transition: "transform 0.5s ease" }}>fast enough</div>
);

const MultiDurationSlowTransitionComponent = () => (
  <div style={{ transition: "transform 0.3s ease, width 2s ease" }}>slow second duration</div>
);

const SlowAnimationShorthandComponent = () => (
  <div style={{ animation: "fadeIn 2s ease" }}>slow animation shorthand</div>
);

const BothZoomRestrictionsComponent = () => (
  <head>
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, user-scalable=no, maximum-scale=1"
    />
  </head>
);

const BorderWidthWithoutColorOk = () => (
  <div style={{ borderLeftWidth: 5, borderLeftStyle: "solid", borderLeftColor: "#ccc" }}>
    neutral border via longhand
  </div>
);

const ShorthandNeutralBorderOk = () => (
  <div style={{ borderLeft: "4px solid #ccc", borderRadius: "8px" }}>
    neutral border via shorthand
  </div>
);

const ShorthandRgbNeutralBorderOk = () => (
  <div style={{ borderLeft: "4px solid rgb(200, 200, 200)", borderRadius: "8px" }}>
    neutral rgb border
  </div>
);

const ShorthandThreeCharHexOk = () => (
  <div style={{ borderLeftWidth: 5, borderLeftStyle: "solid", borderLeftColor: "#aaa" }}>
    neutral 3-char hex border
  </div>
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
  PureBlackBgComponent,
  PureBlackBgShortComponent,
  PureBlackTailwindComponent,
  GradientTextInlineComponent,
  GradientTextTailwindComponent,
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
  OutlineNoneComponent,
  OutlineZeroComponent,
  OutlineNoneWithShadowOk,
  SlowTransitionComponent,
  SlowTransitionDurationComponent,
  CleanComponent,
  ReasonableZIndexComponent,
  SmoothEasingComponent,
  NormalBorderComponent,
  NearBlackComponent,
  OpacityTransitionComponent,
  NormalViewportComponent,
  FastTransitionComponent,
  MultiDurationSlowTransitionComponent,
  SlowAnimationShorthandComponent,
  BothZoomRestrictionsComponent,
  BorderWidthWithoutColorOk,
  ShorthandNeutralBorderOk,
  ShorthandRgbNeutralBorderOk,
  ShorthandThreeCharHexOk,
};
