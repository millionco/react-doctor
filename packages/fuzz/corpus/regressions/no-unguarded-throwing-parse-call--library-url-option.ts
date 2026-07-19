// rule: no-unguarded-throwing-parse-call
// weakness: name-heuristic
// source: local RDE validation (tldraw Editor deep-link options)
export class Editor {
  navigateToDeepLink(options?: { url?: string | URL }): URL {
    return new URL(options?.url ?? window.location.href);
  }
}
