import * as fs from "node:fs";
import * as path from "node:path";

const WORKFLOWS_DIRECTORY = path.join(".github", "workflows");

// The floating major the React Doctor action recommends pinning to. AGENTS.md:
// never reference the action by a mutable branch — `@main` runs whatever HEAD
// points to, with the workflow's write permissions, a supply-chain risk (#299).
const RECOMMENDED_ACTION_REF = "v2";

// A `uses:` reference to the React Doctor action pinned to a MUTABLE branch
// (`@main` / `@master`). Only these are unsafe; a pinned tag (`@v2.1.0`) or a
// commit SHA is a deliberate pin and left untouched. The capture group keeps the
// `uses: <owner>/react-doctor@` prefix so only the ref is rewritten.
const MUTABLE_ACTION_REF = /(uses:\s*[\w.-]+\/react-doctor@)(?:main|master)\b/g;

const isWorkflowFile = (fileName: string): boolean => /\.ya?ml$/.test(fileName);

/**
 * Rewrites mutable `@main` / `@master` React Doctor GitHub Action references in
 * the repo's `.github/workflows/*.yml` to the recommended floating major
 * (`@v2`) — a supply-chain hardening (#299) that also moves the workflow onto
 * the current (install- and scan-cached) action release. Pinned tags / SHAs are
 * deliberate and left untouched. Returns the absolute paths of the workflow
 * files it rewrote — empty when there's nothing to migrate.
 */
export const migrateActionPin = (projectRoot: string): string[] => {
  const workflowsDirectory = path.join(projectRoot, WORKFLOWS_DIRECTORY);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workflowsDirectory, { withFileTypes: true });
  } catch {
    return []; // no .github/workflows — nothing to migrate
  }

  const rewrittenFiles: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isWorkflowFile(entry.name)) continue;
    const workflowPath = path.join(workflowsDirectory, entry.name);

    let contents: string;
    try {
      contents = fs.readFileSync(workflowPath, "utf-8");
    } catch {
      continue;
    }

    const updated = contents.replace(MUTABLE_ACTION_REF, `$1${RECOMMENDED_ACTION_REF}`);
    if (updated === contents) continue;

    try {
      fs.writeFileSync(workflowPath, updated);
      rewrittenFiles.push(workflowPath);
    } catch {
      // A write failure leaves the file untouched; the migration stays pending
      // and retries on the next scan.
    }
  }
  return rewrittenFiles;
};
