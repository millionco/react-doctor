import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const openFile = (filePath: string): void => {
  const absolutePath = path.resolve(filePath);
  const url = pathToFileURL(absolutePath).toString();

  if (process.platform === "win32") {
    const cmdEscapedUrl = url.replace(/%/g, "%%");
    execSync(`start "" "${cmdEscapedUrl}"`, { stdio: "ignore" });
    return;
  }

  const openCommand =
    process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  execSync(openCommand, { stdio: "ignore" });
};
