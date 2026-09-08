import { readFileSync } from "node:fs";

// `import(/* webpackIgnore: true */ /* @vite-ignore */ path)` explicitly
// opts the import out of bundling — the module is resolved at runtime (a
// user-configured plugin script), so there is nothing the bundler could ever
// split and the "stays in the main bundle" premise is void. Comments aren't
// in the AST, so the annotation is read from the file text inside the
// expression's span (same disk-read precedent as exhaustive-deps
// suppression). Only files that actually carry an annotation cache their
// text; the common no-annotation file caches a flat `false`.
export const BUNDLER_IGNORE_ANNOTATION_PATTERN = /webpackIgnore\s*:\s*true|@vite-ignore/;

const annotatedFileTextCache = new Map<string, string | false>();

export const resetBundlerIgnoreAnnotatedFileTextCache = (): void => {
  annotatedFileTextCache.clear();
};

export const readBundlerIgnoreAnnotatedFileText = (filename: string | undefined): string | null => {
  if (!filename) return null;
  const cached = annotatedFileTextCache.get(filename);
  if (cached !== undefined) return cached === false ? null : cached;
  let annotatedText: string | false = false;
  try {
    const text = readFileSync(filename, "utf8");
    if (BUNDLER_IGNORE_ANNOTATION_PATTERN.test(text)) annotatedText = text;
  } catch {
    annotatedText = false;
  }
  annotatedFileTextCache.set(filename, annotatedText);
  return annotatedText === false ? null : annotatedText;
};
