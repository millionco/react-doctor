import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  parseCgroupMemoryLimitBytes,
  readCgroupMemoryLimitBytes,
} from "../src/utils/read-cgroup-memory-limit-bytes.js";

describe("parseCgroupMemoryLimitBytes", () => {
  it("parses a numeric cgroup v2 / v1 byte value", () => {
    expect(parseCgroupMemoryLimitBytes("4294967296")).toBe(4294967296);
    expect(parseCgroupMemoryLimitBytes(" 4294967296\n")).toBe(4294967296);
  });

  it("treats the cgroup v2 'max' literal as no limit", () => {
    expect(parseCgroupMemoryLimitBytes("max")).toBe(undefined);
    expect(parseCgroupMemoryLimitBytes(" max \n")).toBe(undefined);
  });

  it("treats an empty / undefined read as no limit", () => {
    expect(parseCgroupMemoryLimitBytes("")).toBe(undefined);
    expect(parseCgroupMemoryLimitBytes("   ")).toBe(undefined);
    expect(parseCgroupMemoryLimitBytes(undefined)).toBe(undefined);
  });

  it("treats the cgroup v1 near-2^63 unlimited sentinel as no limit", () => {
    // The canonical v1 "unlimited" value on a 64-bit host.
    expect(parseCgroupMemoryLimitBytes("9223372036854771712")).toBe(undefined);
  });

  it("treats non-positive or non-numeric values as no limit", () => {
    expect(parseCgroupMemoryLimitBytes("0")).toBe(undefined);
    expect(parseCgroupMemoryLimitBytes("-1")).toBe(undefined);
    expect(parseCgroupMemoryLimitBytes("not-a-number")).toBe(undefined);
  });
});

describe("readCgroupMemoryLimitBytes", () => {
  let temporaryDirectory: string;
  const missingPath = "/nonexistent/react-doctor-cgroup-test/memory.max";

  const writeLimitFile = (fileName: string, contents: string): string => {
    const filePath = path.join(temporaryDirectory, fileName);
    fs.writeFileSync(filePath, contents);
    return filePath;
  };

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-cgroup-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("prefers the first (v2) path when both yield a limit", () => {
    const v2Path = writeLimitFile("v2-memory.max", "2147483648");
    const v1Path = writeLimitFile("v1-limit_in_bytes", "4294967296");
    expect(readCgroupMemoryLimitBytes([v2Path, v1Path])).toBe(2147483648);
  });

  it("falls through to the next path when the first is unreadable", () => {
    const v1Path = writeLimitFile("v1-limit_in_bytes", "4294967296");
    expect(readCgroupMemoryLimitBytes([missingPath, v1Path])).toBe(4294967296);
  });

  it("falls through when the first path reports 'max' (no limit there)", () => {
    const v2Path = writeLimitFile("v2-memory.max", "max");
    const v1Path = writeLimitFile("v1-limit_in_bytes", "4294967296");
    expect(readCgroupMemoryLimitBytes([v2Path, v1Path])).toBe(4294967296);
  });

  it("returns undefined when no path yields a real limit", () => {
    const unlimitedV2Path = writeLimitFile("v2-memory.max", "max");
    expect(readCgroupMemoryLimitBytes([missingPath, unlimitedV2Path])).toBe(undefined);
  });

  it("returns a positive byte count or undefined on the real system (no throw)", () => {
    // Dev Macs / Windows have no /sys/fs/cgroup → undefined; a Linux container
    // returns its limit. Either way it must never throw or be non-positive.
    const limit = readCgroupMemoryLimitBytes();
    expect(limit === undefined || (typeof limit === "number" && limit > 0)).toBe(true);
  });
});
