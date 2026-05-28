export interface RuleGate {
  framework?: string;
  requires?: ReadonlyArray<string>;
  disabledBy?: ReadonlyArray<string>;
  tags?: ReadonlyArray<string>;
}

// Decides whether a rule is active for a given capability set. Mirrors the
// `shouldEnableRule` contract from `@react-doctor/core` but folds framework
// gating into the same predicate: a non-`global` rule needs its framework
// token in the capability set, every `requires` token must be present, no
// `disabledBy` token may be present, and no `tags` token may be ignored.
export const shouldEnableRule = (
  gate: RuleGate,
  capabilities: ReadonlySet<string>,
  ignoredTags: ReadonlySet<string>,
): boolean => {
  if (gate.framework && gate.framework !== "global" && !capabilities.has(gate.framework)) {
    return false;
  }
  if (gate.requires) {
    for (const capability of gate.requires) {
      if (!capabilities.has(capability)) return false;
    }
  }
  if (gate.disabledBy) {
    for (const capability of gate.disabledBy) {
      if (capabilities.has(capability)) return false;
    }
  }
  if (gate.tags) {
    for (const tag of gate.tags) {
      if (ignoredTags.has(tag)) return false;
    }
  }
  return true;
};
