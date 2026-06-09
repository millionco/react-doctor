// Turns arbitrary text into a URL slug via a sequence of focused replacements.
export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
