import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import fg from "fast-glob";
import { fromMarkdown } from "mdast-util-from-markdown";
import { collectStaticModulePackageNames } from "./collect-static-module-package-names.js";

const AGENT_SKILL_DIRECTORIES = [".agents/skills", ".claude/skills", "skills"];
const AGENT_SKILL_SOURCE_GLOB = "**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}";

const collectCodeBlocks = (value: unknown, codeBlocks: string[]): void => {
  if (!value || typeof value !== "object") return;
  if (
    "type" in value &&
    value.type === "code" &&
    "value" in value &&
    typeof value.value === "string"
  ) {
    codeBlocks.push(value.value);
  }
  if (!("children" in value) || !Array.isArray(value.children)) return;
  for (const child of value.children) collectCodeBlocks(child, codeBlocks);
};

export const collectInstalledAgentSkillPackageNames = (
  searchRootDirectories: ReadonlyArray<string>,
  declaredPackageNames: ReadonlySet<string>,
): Set<string> => {
  const packageNames = new Set<string>();
  const visitedSkillDirectories = new Set<string>();
  for (const rootDirectory of searchRootDirectories) {
    const skillsLockPath = join(rootDirectory, "skills-lock.json");
    if (!existsSync(skillsLockPath)) continue;

    let installedSkillNames: Set<string>;
    try {
      const skillsLock = JSON.parse(readFileSync(skillsLockPath, "utf8"));
      if (!skillsLock.skills || typeof skillsLock.skills !== "object") continue;
      installedSkillNames = new Set(Object.keys(skillsLock.skills));
    } catch {
      continue;
    }

    for (const agentSkillDirectory of AGENT_SKILL_DIRECTORIES) {
      for (const skillDirectory of fg.sync("*", {
        cwd: join(rootDirectory, agentSkillDirectory),
        absolute: true,
        onlyDirectories: true,
        followSymbolicLinks: true,
      })) {
        if (!installedSkillNames.has(basename(skillDirectory))) continue;
        let canonicalSkillDirectory: string;
        try {
          canonicalSkillDirectory = realpathSync(skillDirectory);
        } catch {
          continue;
        }
        if (visitedSkillDirectories.has(canonicalSkillDirectory)) continue;
        visitedSkillDirectories.add(canonicalSkillDirectory);

        for (const sourcePath of fg.sync(AGENT_SKILL_SOURCE_GLOB, {
          cwd: canonicalSkillDirectory,
          absolute: true,
          onlyFiles: true,
        })) {
          try {
            for (const packageName of collectStaticModulePackageNames(
              readFileSync(sourcePath, "utf8"),
            )) {
              if (declaredPackageNames.has(packageName)) packageNames.add(packageName);
            }
          } catch {
            continue;
          }
        }

        for (const markdownPath of fg.sync("**/*.md", {
          cwd: canonicalSkillDirectory,
          absolute: true,
          onlyFiles: true,
        })) {
          try {
            const codeBlocks: string[] = [];
            collectCodeBlocks(fromMarkdown(readFileSync(markdownPath, "utf8")), codeBlocks);
            for (const codeBlock of codeBlocks) {
              for (const packageName of collectStaticModulePackageNames(codeBlock)) {
                if (declaredPackageNames.has(packageName)) packageNames.add(packageName);
              }
            }
          } catch {
            continue;
          }
        }
      }
    }
  }
  return packageNames;
};
