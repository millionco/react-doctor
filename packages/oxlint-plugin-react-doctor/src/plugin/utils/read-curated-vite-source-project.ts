import * as path from "node:path";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { readNamedVite8CallbackCompiler } from "./read-named-vite8-callback-compiler.js";
import type { RuleContext } from "./rule-context.js";
import { shouldUseCuratedPortBehavior } from "./should-use-curated-port-behavior.js";
import { STOCK_VITE8_CALLBACK_PROFILE } from "./stock-vite8-callback-profile.js";

export const readCuratedViteSourceProject = (context: RuleContext) => {
  if (!shouldUseCuratedPortBehavior(context.settings)) return null;
  const root = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const filename = context.filename;
  const source = context.getSourceText?.();
  if (!root || !filename || !source) return null;
  return (
    readNamedVite8CallbackCompiler(
      root,
      path.resolve(root, filename),
      source,
      STOCK_VITE8_CALLBACK_PROFILE,
      { collectSourceProject: true },
    )?.sourceProject ?? null
  );
};
