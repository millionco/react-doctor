import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { readsVerifiedPackageLauncher } from "./reads-verified-package-launcher.js";
import stockLauncher from "./stock-pnpm-launcher-template.json" with { type: "json" };

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const setup = (route: "package-link" | "virtual-store") => {
  const projectDirectory = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "vite-launcher-"),
  );
  roots.push(projectDirectory);
  const modules = path.join(projectDirectory, "node_modules");
  const virtualStore = path.join(modules, ".pnpm");
  const packageDirectory = path.join(virtualStore, "vite@1.0.0", "node_modules", "vite");
  const binaryDirectory = path.join(packageDirectory, "bin");
  fs.mkdirSync(binaryDirectory, { recursive: true });
  fs.writeFileSync(path.join(binaryDirectory, "vite.js"), "");
  const packageLink = path.join(modules, "vite");
  fs.symlinkSync(packageDirectory, packageLink, "dir");
  const launcherDirectory = path.join(modules, ".bin");
  fs.mkdirSync(launcherDirectory);
  const relativeEntry =
    route === "package-link"
      ? "vite/bin/vite.js"
      : ".pnpm/vite@1.0.0/node_modules/vite/bin/vite.js";
  const moduleDirectories = [
    path.join(binaryDirectory, "node_modules"),
    path.join(packageDirectory, "node_modules"),
    path.dirname(packageDirectory),
    path.join(virtualStore, "node_modules"),
  ];
  const script = stockLauncher.template
    .replaceAll("{{moduleSearchPath}}", moduleDirectories.join(":"))
    .replaceAll("{{localEntrypoint}}", "$basedir/../" + relativeEntry);
  fs.writeFileSync(path.join(launcherDirectory, "vite"), script, { mode: 0o755 });
  const verify = () =>
    readsVerifiedPackageLauncher({
      projectRoot: projectDirectory,
      projectDirectory,
      packageDirectory,
      binary: "vite",
    });
  return { modules, packageLink, verify };
};

describe.skipIf(process.platform === "win32")("stock pnpm Vite launcher", () => {
  it.each(["package-link", "virtual-store"] as const)("accepts the %s route", (route) => {
    expect(setup(route).verify()).toBe(true);
  });

  it("declines a package link to a different Vite installation", () => {
    const { modules, packageLink, verify } = setup("package-link");
    const replacement = path.join(modules, ".pnpm", "vite@2.0.0", "node_modules", "vite");
    fs.mkdirSync(path.join(replacement, "bin"), { recursive: true });
    fs.writeFileSync(path.join(replacement, "bin", "vite.js"), "");
    fs.unlinkSync(packageLink);
    fs.symlinkSync(replacement, packageLink, "dir");
    expect(verify()).toBe(false);
  });
});
