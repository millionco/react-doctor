import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Email HTML is rendered once to a static document and mailed — it never
// hydrates and cannot use framework runtime components like `next/image`.
// A file importing an email templating library is an email template, so
// browser-runtime rules should stay quiet there.
const EMAIL_TEMPLATE_MODULES: ReadonlyArray<string> = [
  "@faire/mjml-react",
  "mjml-react",
  "mjml",
  "react-email",
];
const EMAIL_TEMPLATE_MODULE_PREFIXES: ReadonlyArray<string> = ["@react-email/", "jsx-email"];

const emailTemplateImportCache = new WeakMap<EsTreeNodeOfType<"Program">, boolean>();

const isEmailTemplateModuleSource = (moduleSource: string): boolean =>
  EMAIL_TEMPLATE_MODULES.includes(moduleSource) ||
  EMAIL_TEMPLATE_MODULE_PREFIXES.some((prefix) => moduleSource.startsWith(prefix));

export const hasEmailTemplateImport = (programRoot: EsTreeNodeOfType<"Program">): boolean => {
  const cached = emailTemplateImportCache.get(programRoot);
  if (cached !== undefined) return cached;
  const found = programRoot.body.some(
    (statement) =>
      isNodeOfType(statement, "ImportDeclaration") &&
      typeof statement.source.value === "string" &&
      isEmailTemplateModuleSource(statement.source.value),
  );
  emailTemplateImportCache.set(programRoot, found);
  return found;
};
