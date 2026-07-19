// rule: window-open-without-noopener
// weakness: alias-guard
// source: Cursor Bugbot review on PR #1392
const rootPrefix = "https://example.com/" as const;
const destinationPrefix = rootPrefix satisfies string;

export const openDestination = (slug: string) => {
  window.open(destinationPrefix + slug, "_blank");
};
