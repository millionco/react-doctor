import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const computeNativeSourceSha256 = (repositoryRoot) => {
  const sourcePaths = [
    ".github/workflows/native-oxlint.yml",
    "native/oxlint/upstream.json",
    "native/oxlint/react-doctor.patch",
    "scripts/native/build-oxlint-binding.mjs",
    "scripts/native/utils/compute-native-source-sha256.mjs",
  ];
  for (const directory of ["rules", "scans", "project-analysis"]) {
    const relativeDirectory = `native/oxlint/${directory}`;
    for (const fileName of fs.readdirSync(path.join(repositoryRoot, relativeDirectory))) {
      if (fileName.endsWith(".rs")) sourcePaths.push(`${relativeDirectory}/${fileName}`);
    }
  }
  const sourceHash = crypto.createHash("sha256");
  for (const relativePath of sourcePaths.sort()) {
    const content = fs
      .readFileSync(path.join(repositoryRoot, relativePath), "utf8")
      .replaceAll("\r\n", "\n");
    sourceHash.update(JSON.stringify([relativePath, content]));
  }
  return sourceHash.digest("hex");
};
