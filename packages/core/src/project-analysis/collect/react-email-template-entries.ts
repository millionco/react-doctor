import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import fg from "fast-glob";
import { extractReactEmailTemplateDirectories } from "../utils/extract-react-email-template-directories.js";
import { parseSourceFile } from "./parse.js";

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
        .filter((templatePath) =>
          parseSourceFile(templatePath).exports.some(
            (exportReference) => exportReference.isDefault && !exportReference.isTypeOnly,
          ),
        ),
    );
  } catch {
    return [];
  }
};
