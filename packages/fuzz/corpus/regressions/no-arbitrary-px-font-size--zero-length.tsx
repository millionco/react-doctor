// rule: no-arbitrary-px-font-size
// weakness: static-value-guard
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const HiddenText = () => <span className="text-[0px]">Collapsed</span>;
