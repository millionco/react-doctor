import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import fg from "fast-glob";
import { extractReactEmailTemplateDirectories } from "../utils/extract-react-email-template-directories.js";

const DEFAULT_EXPORT_PATTERN = /\bexport\s+default\b/;

export const extractReactEmailTemplateEntries = (directory: string): string[] => {
  const packageJsonPath = resolve(directory, "package.json");
  if (!existsSync(packageJsonPath)) return [];
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies,
    };
    if (!("react-email" in dependencies) && !("@react-email/preview-server" in dependencies)) {
      return [];
    }
    const scripts = Object.values(packageJson.scripts ?? {}).filter(
      (script): script is string => typeof script === "string",
    );
    return extractReactEmailTemplateDirectories(scripts).flatMap((templateDirectory) =>
      fg
        .sync("**/*.{js,jsx,tsx}", {
          cwd: resolve(directory, templateDirectory),
          absolute: true,
          onlyFiles: true,
          ignore: ["**/_*/**", "**/_*.*"],
        })
        .filter((templatePath) => DEFAULT_EXPORT_PATTERN.test(readFileSync(templatePath, "utf8"))),
    );
  } catch {
    return [];
  }
};
