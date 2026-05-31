import path from "node:path";
import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const JSX_NOT_ALLOWED = (extension: string): string =>
  `This file has JSX but a \`${extension}\` name.`;
const EXTENSION_ONLY_FOR_JSX = (extension: string): string =>
  `\`${extension}\` files are meant for JSX, but this one has none.`;

interface JsxFilenameExtensionSettings {
  extensions?: ReadonlyArray<string>;
  allow?: "always" | "as-needed";
  ignoreFilesWithoutCode?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<JsxFilenameExtensionSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { jsxFilenameExtension?: JsxFilenameExtensionSettings })
          .jsxFilenameExtension ?? {})
      : {};
  return {
    extensions: ruleSettings.extensions ?? ["jsx", "tsx"],
    allow: ruleSettings.allow ?? "always",
    ignoreFilesWithoutCode: ruleSettings.ignoreFilesWithoutCode ?? false,
  };
};

const normalizeExtensions = (raw: ReadonlyArray<string>): Set<string> => {
  const set = new Set<string>();
  for (const item of raw) set.add(item.startsWith(".") ? item.slice(1) : item);
  return set;
};

// Port of `oxc_linter::rules::react::jsx_filename_extension`. Reports
//   - JSX in a file whose extension isn't in the allowed set (default
//     `jsx`, `tsx`),
//   - in `as-needed` mode, allowed-extension files that contain NO
//     JSX content (the file claims to be JSX but isn't).
export const jsxFilenameExtension = defineRule<Rule>({
  id: "jsx-filename-extension",
  title: "JSX in disallowed file extension",
  severity: "warn",
  // Pure file-naming convention — Next.js / Docusaurus / Vite all
  // accept JSX in `.js` files out of the box. Forcing `.jsx` /
  // `.tsx` is a project-specific style choice. Default off.
  defaultEnabled: false,
  recommendation: "Name files with JSX `.jsx` or `.tsx`, or whatever extension your project uses.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const allowedExtensions = normalizeExtensions(settings.extensions);
    const filename = normalizeFilename(context.filename ?? "fixture.tsx");
    const extensionOnly = path.extname(filename).slice(1);
    const fileHasAllowedExtension = allowedExtensions.has(extensionOnly);
    let didReportMismatch = false;

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        if (settings.allow !== "as-needed") return;
        if (!fileHasAllowedExtension) return;
        // ignoreFilesWithoutCode skips empty files; our heuristic
        // checks for any non-comment statement in the body.
        const hasAnyStatements = Array.isArray(node.body) && node.body.length > 0;
        if (settings.ignoreFilesWithoutCode && !hasAnyStatements) return;
        if (containsJsxElement(node as EsTreeNode)) return;
        context.report({
          node,
          message: EXTENSION_ONLY_FOR_JSX(`.${extensionOnly}`),
        });
      },
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (didReportMismatch || fileHasAllowedExtension) return;
        didReportMismatch = true;
        context.report({
          node,
          message: JSX_NOT_ALLOWED(`.${extensionOnly}`),
        });
      },
      JSXFragment(node: EsTreeNodeOfType<"JSXFragment">) {
        if (didReportMismatch || fileHasAllowedExtension) return;
        didReportMismatch = true;
        context.report({
          node,
          message: JSX_NOT_ALLOWED(`.${extensionOnly}`),
        });
      },
    };
  },
});
