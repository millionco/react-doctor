import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  installNodeViaNvm,
  isNvmInstalled,
  resolveNodeForOxlint,
} from "../src/utils/resolve-compatible-node.js";

const VERSION_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, "version");

const setProcessVersion = (version: string): void => {
  Object.defineProperty(process, "version", {
    configurable: true,
    value: version,
  });
};

const restoreProcessVersion = (): void => {
  if (VERSION_DESCRIPTOR) {
    Object.defineProperty(process, "version", VERSION_DESCRIPTOR);
  }
};

const writeNodeShim = (binaryPath: string, version: string): void => {
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, `#!/usr/bin/env sh\nprintf '${version}\\n'\n`);
  fs.chmodSync(binaryPath, 0o755);
};

describe("resolve-compatible-node", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-node-"));
    vi.stubEnv("NVM_DIR", directory);
  });

  afterEach(() => {
    restoreProcessVersion();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("reports nvm as installed when NVM_DIR exists", () => {
    expect(isNvmInstalled()).toBe(true);
  });

  it("uses current node when version is already compatible", () => {
    setProcessVersion("v22.12.0");

    expect(resolveNodeForOxlint()).toEqual({
      binaryPath: process.execPath,
      isCurrentNode: true,
      version: "v22.12.0",
    });
  });

  it("uses newest compatible nvm node when current node is too old", () => {
    setProcessVersion("v18.20.0");
    writeNodeShim(path.join(directory, "versions/node/v20.19.0/bin/node"), "v20.19.0");
    writeNodeShim(path.join(directory, "versions/node/v22.13.1/bin/node"), "v22.13.1");
    writeNodeShim(path.join(directory, "versions/node/v22.11.0/bin/node"), "v22.11.0");

    expect(resolveNodeForOxlint()).toEqual({
      binaryPath: path.join(directory, "versions/node/v22.13.1/bin/node"),
      isCurrentNode: false,
      version: "v22.13.1",
    });
  });

  it("returns null when current node is too old and no compatible nvm binary exists", () => {
    setProcessVersion("v18.20.0");
    fs.mkdirSync(path.join(directory, "versions/node/v22.13.1/bin"), { recursive: true });

    expect(resolveNodeForOxlint()).toBeNull();
  });

  it("returns false when nvm install command fails", () => {
    fs.writeFileSync(path.join(directory, "nvm.sh"), "return 1\n");

    expect(installNodeViaNvm()).toBe(false);
  });

  it("finds nvm in the default home directory when NVM_DIR is unset", () => {
    vi.unstubAllEnvs();
    const homeDirectory = path.join(directory, "home");
    const defaultNvmDirectory = path.join(homeDirectory, ".nvm");
    fs.mkdirSync(defaultNvmDirectory, { recursive: true });
    vi.spyOn(os, "homedir").mockReturnValue(homeDirectory);

    expect(isNvmInstalled()).toBe(true);
  });

  it("returns true when nvm install creates a compatible binary", () => {
    fs.writeFileSync(
      path.join(directory, "nvm.sh"),
      [
        "nvm() {",
        'mkdir -p "$NVM_DIR/versions/node/v$NODE_MAJOR.99.0/bin"',
        "cat > \"$NVM_DIR/versions/node/v$NODE_MAJOR.99.0/bin/node\" <<'EOF'",
        "#!/usr/bin/env sh",
        'printf "v$NODE_MAJOR.99.0\\n"',
        "EOF",
        'chmod +x "$NVM_DIR/versions/node/v$NODE_MAJOR.99.0/bin/node"',
        "}",
      ].join("\n"),
    );

    expect(installNodeViaNvm()).toBe(true);
  });
});
