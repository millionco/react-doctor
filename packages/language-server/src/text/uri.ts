import path from "node:path";
import { URI } from "vscode-uri";

/** Absolute, forward-slash path used as the canonical key everywhere. */
export const normalizeFsPath = (filePath: string): string =>
  path.resolve(filePath).replace(/\\/g, "/");

/** Canonical `file://` URI for an absolute path. */
export const fsPathToUri = (filePath: string): string =>
  URI.file(normalizeFsPath(filePath)).toString();

/** Filesystem path (normalized) for a document URI. */
export const uriToFsPath = (uri: string): string => normalizeFsPath(URI.parse(uri).fsPath);

/**
 * Round-trips a client-supplied URI through the path layer so it matches
 * the keys the server stores (`URI.file(fsPath).toString()`), absorbing
 * casing / encoding differences between clients.
 */
export const canonicalizeUri = (uri: string): string => fsPathToUri(uriToFsPath(uri));
