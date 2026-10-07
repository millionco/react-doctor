import * as fs from "node:fs";
import { PERCENT_MULTIPLIER, RULE_TIMING_CREATE_SELECTOR } from "./constants.ts";
import { parseRulePerformanceTimings } from "./parse-rule-performance-timings.ts";
import { collectProfilePaths } from "./profile-frames.ts";
import type { RuleTimingRow, RuleTimingSummary, SelectorTimingRow } from "./types.ts";

interface MutableTimingBucket {
  totalMilliseconds: number;
  calls: number;
  createMilliseconds: number;
  byPartner: Map<string, number>;
}

const RULE_SELECTOR_PREFIX = "react-doctor/";

const splitRuleAndSelector = (encodedRule: string): { rule: string; selector: string } => {
  const separatorIndex = encodedRule.indexOf(":", RULE_SELECTOR_PREFIX.length);
  if (!encodedRule.startsWith(RULE_SELECTOR_PREFIX) || separatorIndex === -1) {
    return { rule: encodedRule, selector: "" };
  }
  return {
    rule: encodedRule.slice(0, separatorIndex),
    selector: encodedRule.slice(separatorIndex + 1),
  };
};

const getBucket = (buckets: Map<string, MutableTimingBucket>, key: string): MutableTimingBucket => {
  const existingBucket = buckets.get(key);
  if (existingBucket !== undefined) return existingBucket;
  const createdBucket: MutableTimingBucket = {
    totalMilliseconds: 0,
    calls: 0,
    createMilliseconds: 0,
    byPartner: new Map(),
  };
  buckets.set(key, createdBucket);
  return createdBucket;
};

const topPartner = (bucket: MutableTimingBucket): string =>
  [...bucket.byPartner.entries()].toSorted((left, right) => right[1] - left[1])[0]?.[0] ?? "";

export const aggregateRuleTimingContents = (contents: readonly string[]): RuleTimingSummary => {
  const ruleBuckets = new Map<string, MutableTimingBucket>();
  const selectorBuckets = new Map<string, MutableTimingBucket>();
  let totalMilliseconds = 0;
  let createMilliseconds = 0;
  for (const content of contents) {
    for (const timing of parseRulePerformanceTimings(content)) {
      const { rule, selector } = splitRuleAndSelector(timing.rule);
      totalMilliseconds += timing.timeMilliseconds;
      const ruleBucket = getBucket(ruleBuckets, rule);
      ruleBucket.totalMilliseconds += timing.timeMilliseconds;
      ruleBucket.calls += timing.calls;
      ruleBucket.byPartner.set(
        selector,
        (ruleBucket.byPartner.get(selector) ?? 0) + timing.timeMilliseconds,
      );
      if (selector === RULE_TIMING_CREATE_SELECTOR) {
        ruleBucket.createMilliseconds += timing.timeMilliseconds;
        createMilliseconds += timing.timeMilliseconds;
      }
      const selectorBucket = getBucket(selectorBuckets, selector);
      selectorBucket.totalMilliseconds += timing.timeMilliseconds;
      selectorBucket.calls += timing.calls;
      selectorBucket.byPartner.set(
        rule,
        (selectorBucket.byPartner.get(rule) ?? 0) + timing.timeMilliseconds,
      );
    }
  }
  const percentOf = (milliseconds: number): number =>
    totalMilliseconds === 0 ? 0 : (milliseconds / totalMilliseconds) * PERCENT_MULTIPLIER;
  const rules: RuleTimingRow[] = [...ruleBuckets.entries()]
    .map(([rule, bucket]) => ({
      rule,
      totalMilliseconds: bucket.totalMilliseconds,
      percentOfTotal: percentOf(bucket.totalMilliseconds),
      calls: bucket.calls,
      createMilliseconds: bucket.createMilliseconds,
      topSelector: topPartner(bucket),
    }))
    .toSorted((left, right) => right.totalMilliseconds - left.totalMilliseconds);
  const selectors: SelectorTimingRow[] = [...selectorBuckets.entries()]
    .map(([selector, bucket]) => ({
      selector,
      totalMilliseconds: bucket.totalMilliseconds,
      percentOfTotal: percentOf(bucket.totalMilliseconds),
      calls: bucket.calls,
      ruleCount: bucket.byPartner.size,
      topRule: topPartner(bucket),
    }))
    .toSorted((left, right) => right.totalMilliseconds - left.totalMilliseconds);
  return { processCount: contents.length, totalMilliseconds, createMilliseconds, rules, selectors };
};

export const aggregateRuleTimings = (profileDirectory: string): RuleTimingSummary | null => {
  const timingPaths = collectProfilePaths({
    directory: profileDirectory,
    extension: ".rule-timings.json",
  });
  if (timingPaths.length === 0) return null;
  return aggregateRuleTimingContents(
    timingPaths.map((timingPath) => fs.readFileSync(timingPath, "utf8")),
  );
};
