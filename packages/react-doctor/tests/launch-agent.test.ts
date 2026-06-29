import { tmpdir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  resolveCursorBundledNode,
  resolveWindowsCmdEntryScript,
} from "../src/cli/utils/launch-agent.js";

describe.skipIf(process.platform !== "win32")("Windows CLI agent launching", () => {
  let fakeBinDirectory: string;
  let fakeLocalAppData: string;
  let originalPath: string | undefined;
  let originalLocalAppData: string | undefined;

  beforeEach(() => {
    fakeBinDirectory = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-launch-"));
    fakeLocalAppData = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-appdata-"));
    originalPath = process.env.PATH;
    originalLocalAppData = process.env.LOCALAPPDATA;
    process.env.PATH = fakeBinDirectory;
    process.env.LOCALAPPDATA = fakeLocalAppData;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.LOCALAPPDATA = originalLocalAppData;
    fs.rmSync(fakeBinDirectory, { recursive: true, force: true });
    fs.rmSync(fakeLocalAppData, { recursive: true, force: true });
  });

  it("resolves Cursor bundled node.exe + index.js when present", () => {
    const versionsDir = path.join(fakeLocalAppData, "cursor-agent", "versions", "1.0.0");
    fs.mkdirSync(versionsDir, { recursive: true });
    fs.writeFileSync(path.join(versionsDir, "node.exe"), "fake node");
    fs.writeFileSync(path.join(versionsDir, "index.js"), "fake entry");

    const resolution = resolveCursorBundledNode();

    expect(resolution).not.toBeNull();
    expect(resolution?.command).toBe(path.join(versionsDir, "node.exe"));
    expect(resolution?.args).toEqual([path.join(versionsDir, "index.js")]);
  });

  it("returns null when LOCALAPPDATA is not set", () => {
    delete process.env.LOCALAPPDATA;

    const resolution = resolveCursorBundledNode();

    expect(resolution).toBeNull();
  });

  it("returns null when cursor-agent directory does not exist", () => {
    const resolution = resolveCursorBundledNode();

    expect(resolution).toBeNull();
  });

  it("picks the latest version when multiple versions exist", () => {
    const versionsRoot = path.join(fakeLocalAppData, "cursor-agent", "versions");
    fs.mkdirSync(versionsRoot, { recursive: true });

    const version1 = path.join(versionsRoot, "1.0.0");
    const version2 = path.join(versionsRoot, "2.0.0");
    const version3 = path.join(versionsRoot, "1.10.0");

    fs.mkdirSync(version1, { recursive: true });
    fs.writeFileSync(path.join(version1, "node.exe"), "fake node");
    fs.writeFileSync(path.join(version1, "index.js"), "fake entry");

    fs.mkdirSync(version2, { recursive: true });
    fs.writeFileSync(path.join(version2, "node.exe"), "fake node");
    fs.writeFileSync(path.join(version2, "index.js"), "fake entry");

    fs.mkdirSync(version3, { recursive: true });
    fs.writeFileSync(path.join(version3, "node.exe"), "fake node");
    fs.writeFileSync(path.join(version3, "index.js"), "fake entry");

    const resolution = resolveCursorBundledNode();

    expect(resolution).not.toBeNull();
    expect(resolution?.command).toBe(path.join(version2, "node.exe"));
  });

  it("returns null when bundled files are incomplete", () => {
    const versionsDir = path.join(fakeLocalAppData, "cursor-agent", "versions", "1.0.0");
    fs.mkdirSync(versionsDir, { recursive: true });
    fs.writeFileSync(path.join(versionsDir, "node.exe"), "fake node");

    const resolution = resolveCursorBundledNode();

    expect(resolution).toBeNull();
  });

  it("falls back to older version when latest is incomplete", () => {
    const versionsRoot = path.join(fakeLocalAppData, "cursor-agent", "versions");
    fs.mkdirSync(versionsRoot, { recursive: true });

    const version1 = path.join(versionsRoot, "1.0.0");
    const version2 = path.join(versionsRoot, "2.0.0");

    fs.mkdirSync(version1, { recursive: true });
    fs.writeFileSync(path.join(version1, "node.exe"), "fake node");
    fs.writeFileSync(path.join(version1, "index.js"), "fake entry");

    fs.mkdirSync(version2, { recursive: true });
    fs.writeFileSync(path.join(version2, "node.exe"), "fake node");

    const resolution = resolveCursorBundledNode();

    expect(resolution).not.toBeNull();
    expect(resolution?.command).toBe(path.join(version1, "node.exe"));
  });

  it("resolves npm-style .cmd wrappers pointing to .js files", () => {
    const cmdFilePath = path.join(fakeBinDirectory, "test-cli.cmd");
    const entryScriptPath = path.join(fakeBinDirectory, "test-cli.js");
    fs.writeFileSync(cmdFilePath, '@echo off\r\nnode "%~dp0\\test-cli.js" %*\r\n');
    fs.writeFileSync(entryScriptPath, "console.log('test');");

    const resolved = resolveWindowsCmdEntryScript("test-cli");

    expect(resolved).toBe(entryScriptPath);
  });

  it("returns null for PowerShell-based .cmd wrappers", () => {
    const cmdFilePath = path.join(fakeBinDirectory, "cursor-agent.cmd");
    fs.writeFileSync(
      cmdFilePath,
      '@echo off\r\npwsh.exe -NoLogo -ExecutionPolicy Bypass -File "%USERPROFILE%\\.local\\bin\\cursor-agent-profile-wrapper.ps1" %*\r\n',
    );

    const resolved = resolveWindowsCmdEntryScript("cursor-agent");

    expect(resolved).toBeNull();
  });

  it("returns null when .cmd file does not exist", () => {
    const resolved = resolveWindowsCmdEntryScript("nonexistent");

    expect(resolved).toBeNull();
  });
});
