import type { BaseRuleContext } from "./rule-context.js";
import type { HostRule } from "./rule-plugin.js";
import type { RuleVisitors } from "./rule-visitors.js";
import {
  isRulePerformanceTimingEnabled,
  recordRulePerformanceTiming,
} from "./record-rule-performance-timing.js";

const CREATE_SELECTOR = "<create>";

export const wrapRuleWithPerformanceTiming = (ruleId: string, rule: HostRule): HostRule => {
  if (!isRulePerformanceTimingEnabled) return rule;
  return {
    ...rule,
    create: (context: BaseRuleContext): RuleVisitors => {
      const createStartedAt = process.hrtime.bigint();
      const visitors = rule.create(context);
      recordRulePerformanceTiming(
        ruleId,
        CREATE_SELECTOR,
        process.hrtime.bigint() - createStartedAt,
      );
      return Object.fromEntries(
        Object.entries(visitors).map(([selector, visitor]) => [
          selector,
          (...parameters: Parameters<typeof visitor>): void => {
            const visitorStartedAt = process.hrtime.bigint();
            try {
              Reflect.apply(visitor, undefined, parameters);
            } finally {
              recordRulePerformanceTiming(
                ruleId,
                selector,
                process.hrtime.bigint() - visitorStartedAt,
              );
            }
          },
        ]),
      );
    },
  };
};
