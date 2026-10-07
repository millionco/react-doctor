// rule: no-gray-on-colored-background
// weakness: cascade-ambiguity
// source: Tailwind CSS utility-conflict documentation
// verdict: pass

export const Badge = () => <span className="bg-blue-600 text-gray-400 text-white">Active</span>;
