// rule: no-img-without-dimensions
// weakness: static-important-override
// source: Tailwind precedence audit after PR #1337 parity
// verdict: fail

export const Hero = () => <img src="/hero.jpg" alt="" className="!w-auto w-10 h-10" />;
