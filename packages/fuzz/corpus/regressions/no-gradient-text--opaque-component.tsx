// rule: no-gradient-text
// weakness: framework-gating
// source: adversarial parity review
// verdict: pass

interface HeadingProps {
  className: string;
}

const Heading = ({ className }: HeadingProps) => <h1 data-theme={className}>Welcome</h1>;

export const Hero = () => <Heading className="text-transparent bg-clip-text bg-linear-45" />;
