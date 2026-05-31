import { GENERATED_BUNDLE_FILE_PATTERN, SOURCE_FILE_PATTERN } from "../project-info/constants.js";

// Single gate for "should react-doctor scan this file?". A file is
// lintable when it's a JS/TS source file AND not a generated bundler
// artifact (`*.iife.js`, `*.global.js`). Accepts either a full path or a
// bare filename — the patterns match on the suffix either way.
export const isLintableSourceFile = (filePath: string): boolean =>
  SOURCE_FILE_PATTERN.test(filePath) && !GENERATED_BUNDLE_FILE_PATTERN.test(filePath);
