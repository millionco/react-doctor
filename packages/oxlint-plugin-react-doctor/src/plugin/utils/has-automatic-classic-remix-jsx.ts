import * as fs from "node:fs";
import * as path from "node:path";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { isPathInside } from "./is-path-inside.js";
import {
  readDeclaredClassicRemixRoute,
  resolveClassicRemixStyleFlags,
} from "./read-declared-classic-remix-route.js";
import { readPhysicalImplicitJsxProgram } from "./read-physical-implicit-jsx-program.js";
import { hasVerifiedClassicRemixCompiler } from "./read-verified-classic-remix-compiler.js";
import type { RuleContext } from "./rule-context.js";

export const hasAutomaticClassicRemixJsx = (context: RuleContext): boolean => {
  const configuredRoot = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (!context.filename?.endsWith(".tsx") || !configuredRoot || !path.isAbsolute(configuredRoot))
    return false;
  const projectRoot = path.resolve(configuredRoot);
  const filename = path.resolve(projectRoot, context.filename);
  if (!isPathInside(filename, path.join(projectRoot, "app", "routes"))) return false;
  try {
    if (!fs.existsSync(path.join(projectRoot, "remix.config.js"))) return false;
    const route = readDeclaredClassicRemixRoute({ projectRoot, filename });
    if (!route) return false;
    const styles = resolveClassicRemixStyleFlags("1.19.3", route.styleFlags);
    return Boolean(
      styles &&
      !styles.postcss &&
      !styles.tailwind &&
      readPhysicalImplicitJsxProgram(context, filename) &&
      hasVerifiedClassicRemixCompiler(route),
    );
  } catch {
    return false;
  }
};
