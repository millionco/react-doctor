import { isRecordWithFields } from "./is-record-with-fields.ts";
import type { OxlintSpawnChildRecord, OxlintSpawnLog, OxlintSpawnParentRecord } from "./types.ts";

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || typeof value === "number";
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isChildRecord = (value: unknown): value is OxlintSpawnChildRecord =>
  isRecordWithFields(value, {
    startedAt: "number",
    endedAt: "number",
    fileCount: "number",
    stdoutBytes: "number",
    stderrBytes: "number",
  }) &&
  isNullableNumber(value.pid) &&
  isNullableString(value.configPath) &&
  isNullableNumber(value.exitCode) &&
  isNullableString(value.signal) &&
  (!("stdoutPreview" in value) || typeof value.stdoutPreview === "string");

const isParentRecord = (value: unknown): value is OxlintSpawnParentRecord =>
  isRecordWithFields(value, {
    pid: "number",
    exitedAt: "number",
    userMicroseconds: "number",
    systemMicroseconds: "number",
  });

export const parseOxlintSpawnLog = (content: string): OxlintSpawnLog => {
  const children: OxlintSpawnChildRecord[] = [];
  let parent: OxlintSpawnParentRecord | null = null;
  for (const line of content.split("\n")) {
    if (line.trim().length === 0) continue;
    const entry: unknown = JSON.parse(line);
    if (!isRecordWithFields(entry, { kind: "string" })) {
      throw new Error(`Invalid oxlint spawn log line: ${line}`);
    }
    if (entry.kind === "child" && isChildRecord(entry)) {
      children.push({
        pid: entry.pid,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        fileCount: entry.fileCount,
        configPath: entry.configPath,
        exitCode: entry.exitCode,
        signal: entry.signal,
        stdoutBytes: entry.stdoutBytes,
        stderrBytes: entry.stderrBytes,
        stdoutPreview: typeof entry.stdoutPreview === "string" ? entry.stdoutPreview : "",
      });
    } else if (entry.kind === "parent" && isParentRecord(entry)) {
      parent = {
        pid: entry.pid,
        exitedAt: entry.exitedAt,
        userMicroseconds: entry.userMicroseconds,
        systemMicroseconds: entry.systemMicroseconds,
      };
    } else {
      throw new Error(`Invalid oxlint spawn log line: ${line}`);
    }
  }
  children.sort((left, right) => left.startedAt - right.startedAt || left.endedAt - right.endedAt);
  return { children, parent };
};
