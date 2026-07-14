// rule: only-export-components
// weakness: framework-gating
// source: PR #1237 adversarial audit

export const Layout = () => <main />;
export const runtimeConfig = getRuntimeConfig();
