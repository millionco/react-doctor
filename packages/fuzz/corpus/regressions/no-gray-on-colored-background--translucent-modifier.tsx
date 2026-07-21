// rule: no-gray-on-colored-background
// weakness: arbitrary-value
// source: adversarial parity review
// verdict: pass

export const Badge = () => <span className="text-gray-500 bg-blue-600/50">Active</span>;
