// rule: no-transition-all
// weakness: control-flow
// source: all-rules parity audit against react-doctor@0.8.1
// verdict: pass

interface TransitionCardProps {
  style: React.CSSProperties;
}

export const TransitionCard = ({ style }: TransitionCardProps) => (
  <div style={{ transition: "all 200ms", ...style }} />
);

export const OpacityCard = () => (
  <div style={{ transition: "all 200ms", transition: "opacity 200ms" }} />
);

export const LonghandOpacityCard = () => (
  <div style={{ transition: "all 200ms", transitionProperty: "opacity" }} />
);

export const ShorthandOpacityCard = () => (
  <div style={{ transitionProperty: "all", transition: "opacity 200ms" }} />
);

export const ZeroDurationCard = () => (
  <div style={{ transition: "all 200ms", transitionDuration: "0s" }} />
);

export const InvalidShorthandCard = () => <div style={{ transition: "opacity all 200ms" }} />;

export const StaticTailwindTransitionCard = () => <div className="transition-all duration-0" />;

export const InlineDurationOverrideCard = () => (
  <div className="transition-all duration-200" style={{ transitionDuration: "0s" }} />
);

export const TailwindPropertyOverrideCard = () => (
  <div className="transition-none" style={{ transitionDuration: "200ms" }} />
);
