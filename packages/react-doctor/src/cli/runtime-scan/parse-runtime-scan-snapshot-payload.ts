import { Buffer } from "node:buffer";
import {
  RUNTIME_SCAN_MAX_COMPONENT_EVENTS,
  RUNTIME_SCAN_MAX_INTERACTIONS,
  RUNTIME_SCAN_MAX_LOAF_ENTRIES,
  RUNTIME_SCAN_MAX_SNAPSHOT_BYTES,
  RUNTIME_SCAN_MAX_SCRIPTS_PER_LOAF,
  RUNTIME_SCAN_MAX_SNAPSHOT_PAYLOAD_BYTES,
  RUNTIME_SCAN_MAX_STRING_LENGTH,
  RUNTIME_SCAN_UNKNOWN_SOURCE_CHAR_POSITION,
} from "./constants.js";
import type {
  RuntimeScanComponentEvent,
  RuntimeScanInteraction,
  RuntimeScanLongAnimationFrame,
  RuntimeScanProbeSnapshot,
  RuntimeScanScriptTiming,
} from "./types.js";

interface RuntimeScanUnknownRecord {
  readonly [key: string]: unknown;
}

const isRecord = (value: unknown): value is RuntimeScanUnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedString = (value: unknown): value is string =>
  typeof value === "string" && value.length <= RUNTIME_SCAN_MAX_STRING_LENGTH;

const isNullableBoundedString = (value: unknown): value is string | null =>
  value === null || isBoundedString(value);

const isSanitizedRuntimeUrl = (value: unknown): value is string => {
  if (!isBoundedString(value) || !URL.canParse(value)) return false;
  const parsedUrl = new URL(value);
  return (
    (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
    parsedUrl.username === "" &&
    parsedUrl.password === "" &&
    parsedUrl.search === "" &&
    parsedUrl.hash === ""
  );
};

const isNonNegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && isNonNegativeFiniteNumber(value);

const isSourceCharPosition = (value: unknown): value is number =>
  value === RUNTIME_SCAN_UNKNOWN_SOURCE_CHAR_POSITION || isNonNegativeSafeInteger(value);

const isSnapshotWithinByteLimit = (value: unknown): boolean => {
  try {
    const serializedSnapshot = JSON.stringify(value);
    return (
      serializedSnapshot !== undefined &&
      Buffer.byteLength(serializedSnapshot) <= RUNTIME_SCAN_MAX_SNAPSHOT_BYTES
    );
  } catch {
    return false;
  }
};

const isScriptTiming = (value: unknown): value is RuntimeScanScriptTiming =>
  isRecord(value) &&
  isBoundedString(value.invoker) &&
  isBoundedString(value.invokerType) &&
  isBoundedString(value.sourceUrl) &&
  isBoundedString(value.sourceFunctionName) &&
  isSourceCharPosition(value.sourceCharPosition) &&
  isNonNegativeFiniteNumber(value.executionStart) &&
  isNonNegativeFiniteNumber(value.durationMs) &&
  isNonNegativeFiniteNumber(value.forcedStyleAndLayoutDurationMs) &&
  isNonNegativeFiniteNumber(value.pauseDurationMs);

const isLongAnimationFrame = (value: unknown): value is RuntimeScanLongAnimationFrame =>
  isRecord(value) &&
  isNonNegativeFiniteNumber(value.startTime) &&
  isNonNegativeFiniteNumber(value.durationMs) &&
  isNonNegativeFiniteNumber(value.blockingDurationMs) &&
  isNonNegativeFiniteNumber(value.renderStart) &&
  isNonNegativeFiniteNumber(value.styleAndLayoutStart) &&
  isNonNegativeFiniteNumber(value.firstUiEventTimestamp) &&
  Array.isArray(value.scripts) &&
  value.scripts.length <= RUNTIME_SCAN_MAX_SCRIPTS_PER_LOAF &&
  value.scripts.every(isScriptTiming);

const isComponentEvent = (value: unknown): value is RuntimeScanComponentEvent =>
  isRecord(value) &&
  isBoundedString(value.name) &&
  isNonNegativeFiniteNumber(value.startTime) &&
  isNonNegativeFiniteNumber(value.durationMs) &&
  isNonNegativeSafeInteger(value.depth) &&
  (value.source === "native" || value.source === "bippy");

const isInteraction = (value: unknown): value is RuntimeScanInteraction =>
  isRecord(value) &&
  isBoundedString(value.name) &&
  isNonNegativeFiniteNumber(value.startTime) &&
  isNonNegativeFiniteNumber(value.durationMs) &&
  isNonNegativeFiniteNumber(value.processingStart) &&
  isNonNegativeFiniteNumber(value.processingEnd) &&
  isNonNegativeSafeInteger(value.interactionId) &&
  (value.documentIndex === undefined || isNonNegativeSafeInteger(value.documentIndex)) &&
  isNullableBoundedString(value.targetTag);

export const isRuntimeScanProbeSnapshot = (value: unknown): value is RuntimeScanProbeSnapshot =>
  isRecord(value) &&
  isNonNegativeFiniteNumber(value.timeOrigin) &&
  isSanitizedRuntimeUrl(value.finalUrl) &&
  isRecord(value.support) &&
  typeof value.support.reactDetected === "boolean" &&
  isNullableBoundedString(value.support.reactVersion) &&
  (value.support.reactBuildType === null ||
    value.support.reactBuildType === "development" ||
    value.support.reactBuildType === "production") &&
  typeof value.support.nativeReactTracks === "boolean" &&
  typeof value.support.bippyComponentTracks === "boolean" &&
  typeof value.support.loaf === "boolean" &&
  Array.isArray(value.longAnimationFrames) &&
  value.longAnimationFrames.length <= RUNTIME_SCAN_MAX_LOAF_ENTRIES &&
  value.longAnimationFrames.every(isLongAnimationFrame) &&
  Array.isArray(value.componentEvents) &&
  value.componentEvents.length <= RUNTIME_SCAN_MAX_COMPONENT_EVENTS &&
  value.componentEvents.every(isComponentEvent) &&
  Array.isArray(value.interactions) &&
  value.interactions.length <= RUNTIME_SCAN_MAX_INTERACTIONS &&
  value.interactions.every(isInteraction) &&
  isNonNegativeFiniteNumber(value.cumulativeLayoutShift) &&
  (value.largestContentfulPaintMs === null ||
    isNonNegativeFiniteNumber(value.largestContentfulPaintMs)) &&
  isNonNegativeSafeInteger(value.droppedLongAnimationFrames) &&
  isNonNegativeSafeInteger(value.droppedScriptTimings) &&
  isNonNegativeSafeInteger(value.droppedComponentEvents) &&
  isNonNegativeSafeInteger(value.droppedInteractions) &&
  isSnapshotWithinByteLimit(value);

export const parseRuntimeScanSnapshotPayload = (
  payload: string,
  expectedToken: string,
): RuntimeScanProbeSnapshot | null => {
  if (Buffer.byteLength(payload) > RUNTIME_SCAN_MAX_SNAPSHOT_PAYLOAD_BYTES) return null;
  try {
    const envelope: unknown = JSON.parse(payload);
    if (
      !isRecord(envelope) ||
      envelope.token !== expectedToken ||
      !isRuntimeScanProbeSnapshot(envelope.snapshot)
    ) {
      return null;
    }
    return envelope.snapshot;
  } catch {
    return null;
  }
};
