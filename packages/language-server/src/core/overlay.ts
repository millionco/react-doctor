import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ADOPTABLE_LINT_CONFIG_FILENAMES,
  STAGED_FILES_PROJECT_CONFIG_FILENAMES,
} from "@react-doctor/core";
import type { TextProvider } from "../types.js";

const OVERLAY_TEMP_PREFIX = "react-doctor-lsp-";

// Project configs + adoptable lint configs (e.g. `.eslintrc.json`) the
// overlay must mirror so an on-type buffer scan resolves the SAME rule set
// as the on-save disk scan; otherwise findings flicker between the two.
const OVERLAY_CONFIG_FILENAMES = [
  ...new Set([...STAGED_FILES_PROJECT_CONFIG_FILENAMES, ...ADOPTABLE_LINT_CONFIG_FILENAMES]),
];

export interface OverlaySnapshot {
  /** Temp directory mirroring the project with overlaid buffer content. */
  readonly tempDirectory: string;
  /** Project-relative (forward-slash) paths written into the overlay. */
  readonly relativePaths: string[];
  /** Real (symlink-resolved) temp directory, for diagnostic path remap. */
  readonly realTempDirectory: string;
  readonly cleanup: () => void;
}

export interface MaterializeOverlayInput {
  /** Absolute project root. */
  readonly projectDirectory: string;
  /** Absolute target file paths to overlay (the open buffers). */
  readonly files: ReadonlyArray<string>;
  /** Reads the live text of a file (open buffer first, then disk). */
  readonly readText: TextProvider;
}

const toProjectRelative = (projectDirectory: string, filePath: string): string | null => {
  const relative = path.relative(projectDirectory, filePath).replace(/\\/g, "/");
  if (relative.length === 0 || relative.startsWith("../") || path.isAbsolute(relative)) return null;
  return relative;
};

/**
 * Writes the live (possibly unsaved) content of the target files into a
 * throwaway temp tree that mirrors the project, alongside the well-known
 * project config files oxlint needs to resolve. The scan runner points
 * the linter at this tree so diagnostics reflect the editor buffer, not
 * stale disk content. Returns `null` when nothing could be materialized
 * (caller falls back to a disk scan).
 */
export const materializeOverlay = (input: MaterializeOverlayInput): OverlaySnapshot | null => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), OVERLAY_TEMP_PREFIX));
  const relativePaths: string[] = [];

  try {
    for (const filePath of input.files) {
      const relative = toProjectRelative(input.projectDirectory, filePath);
      if (relative === null) continue;
      const content = input.readText(filePath);
      if (content === null) continue;
      const target = path.join(tempDirectory, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      relativePaths.push(relative);
    }

    if (relativePaths.length === 0) {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
      return null;
    }

    for (const configFilename of OVERLAY_CONFIG_FILENAMES) {
      const source = path.join(input.projectDirectory, configFilename);
      const target = path.join(tempDirectory, configFilename);
      if (fs.existsSync(source) && !fs.existsSync(target)) {
        try {
          fs.cpSync(source, target);
        } catch {
          // Best-effort: a missing/locked config just degrades resolution.
        }
      }
    }

    let realTempDirectory = tempDirectory;
    try {
      realTempDirectory = fs.realpathSync(tempDirectory);
    } catch {
      // Keep the non-resolved path if realpath fails.
    }

    return {
      tempDirectory,
      realTempDirectory,
      relativePaths,
      cleanup: () => {
        try {
          fs.rmSync(tempDirectory, { recursive: true, force: true });
        } catch {
          // OS tempdir reapers eventually reclaim it.
        }
      },
    };
  } catch (error) {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
    throw error;
  }
};
