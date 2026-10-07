// rule: no-gray-on-colored-background
// weakness: framework-gating
// source: adversarial parity review
// verdict: pass

interface BadgeProps {
  className: string;
}

const Badge = ({ className }: BadgeProps) => <span data-theme={className}>Active</span>;

export const Status = () => <Badge className="text-gray-500 bg-blue-600" />;
