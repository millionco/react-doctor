// rule: no-smooth-scroll-without-reduced-motion
// weakness: arbitrary-value-tokenization
// source: 0.8.1-to-main all-rules parity review
// verdict: pass

export const Page = () => <main className="[--behavior:scroll-smooth fallback]" />;
