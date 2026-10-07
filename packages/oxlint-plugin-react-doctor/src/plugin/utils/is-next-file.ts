import {
  declaresAnyDependency,
  declaresDependency,
  findNearestPackageDirectory,
} from "./classify-package-platform.js";
import { isPackageWithinProjectRoot } from "./is-package-within-project-root.js";
import { normalizeFilename } from "./normalize-filename.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { readNearestPackageManifest } from "./read-nearest-package-manifest.js";
import type { RuleContext } from "./rule-context.js";

// Whether Next.js rules should run on `filename`. The project-level
// capability gate (`requires: ["nextjs"]`) only says SOME workspace in the
// scanned project depends on Next — in a monorepo that also enables the
// Next rules (several at error severity) for web-only sibling packages
// (a Vite playground, a plain component library) whose files never run
// under Next. The nearest `package.json` is the authority:
//
//   1. No filename (stripped-down test harness) or no discoverable /
//      parseable manifest → active. The project capability gate already
//      established the project uses Next.
//   2. The nearest manifest declares `next` in any dependency section →
//      active.
//   3. The nearest manifest declares dependencies but no `next` AND sits
//      below the project root (a nested workspace package) → inactive.
//      The package's own manifest says it never depends on Next.
//   4. Otherwise (marker-only manifest, or the project-root manifest the
//      nextjs capability may itself have been derived from) → active.
export const isNextFileActive = (context: RuleContext): boolean => {
  const rawFilename = context.filename;
  if (!rawFilename) return true;
  const filename = normalizeFilename(rawFilename);

  const manifest = readNearestPackageManifest(filename);
  if (!manifest) return true;
  if (declaresDependency(manifest, "next")) return true;
  if (!declaresAnyDependency(manifest)) return true;

  const packageDirectory = findNearestPackageDirectory(filename);
  const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (
    packageDirectory !== null &&
    isPackageWithinProjectRoot(packageDirectory, rootDirectory, false)
  ) {
    return false;
  }
  return true;
};
