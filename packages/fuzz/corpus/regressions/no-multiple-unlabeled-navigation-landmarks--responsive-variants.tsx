// rule: no-multiple-unlabeled-navigation-landmarks
// weakness: framework-gating
// source: RDE OSS corpus, langfuse/langfuse web

export const SettingsNavigation = () => (
  <main>
    <nav className="block md:hidden">Mobile settings</nav>
    <nav className="hidden md:grid">Desktop settings</nav>
  </main>
);
