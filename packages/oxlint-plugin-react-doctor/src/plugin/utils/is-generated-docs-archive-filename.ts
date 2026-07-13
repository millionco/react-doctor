import { normalizeFilename } from "./normalize-filename.js";

const GENERATED_DOCS_ARCHIVE_PATH_PATTERN =
  /(?:^|\/)(?:docs?|documentation)\/archive\/[^/]+\/static\/(?:[^/]+\/)*docs\.js$/i;

export const isGeneratedDocsArchiveFilename = (filename: string | undefined): boolean =>
  GENERATED_DOCS_ARCHIVE_PATH_PATTERN.test(normalizeFilename(filename ?? ""));
