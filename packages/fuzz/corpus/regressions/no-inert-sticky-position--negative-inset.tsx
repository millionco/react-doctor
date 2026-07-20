// rule: no-inert-sticky-position
// weakness: tailwind-negative-utility
// source: PR #1337 all-rules RDE parity (langfuse/langfuse)
export const StickyHeader = () => <header className="sticky -top-4">Experiments</header>;
