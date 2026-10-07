import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonNullAssertionOnMaybeUndefinedResult } from "./no-non-null-assertion-on-maybe-undefined-result.js";

describe("no-non-null-assertion-on-maybe-undefined-result React Bench regressions", () => {
  it("accepts ensure-then-get with a stable const member key", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const group = (results) => {
  const groups = new Map();
  for (const result of results) {
    if (!groups.has(result.section.titleKey)) {
      groups.set(result.section.titleKey, []);
    }
    groups.get(result.section.titleKey)!.push(result.item);
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps ensure-then-get when the member key changes", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const group = () => {
  const groups = new Map();
  const result = { section: { titleKey: "first" } };
  if (!groups.has(result.section.titleKey)) {
    groups.set(result.section.titleKey, []);
  }
  result.section.titleKey = "second";
  groups.get(result.section.titleKey)!.push(result);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps ensure-then-get when the lookup uses a different member", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const group = (result) => {
  const groups = new Map();
  if (!groups.has(result.section.titleKey)) {
    groups.set(result.section.titleKey, []);
  }
  groups.get(result.section.otherKey)!.push(result);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps ensure-then-get when an alias mutates the member key", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const group = (result) => {
  const groups = new Map();
  if (!groups.has(result.section.titleKey)) {
    groups.set(result.section.titleKey, []);
  }
  const section = result.section;
  section.titleKey = "second";
  return groups.get(result.section.titleKey)!.length;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps ensure-then-get when the member owner escapes to a call", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const group = (result, mutate) => {
  const groups = new Map();
  if (!groups.has(result.section.titleKey)) {
    groups.set(result.section.titleKey, []);
  }
  mutate(result.section);
  return groups.get(result.section.titleKey)!.length;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a nullable conditional findUpUntil result", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from "@cloudscape-design/component-toolkit/dom";
const pattern = /context-([\\w-]+)/;
const read = (element) => {
  const parent = element ? findUpUntil(element, node => !!node.className.match(pattern)) : undefined;
  return parent?.className.match(pattern)![1] ?? "";
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a conditional finder result with a non-nullish fallback", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from "@cloudscape-design/component-toolkit/dom";
const pattern = /context-([\\w-]+)/;
const read = (element, fallback) => {
  const parent = element ? findUpUntil(element, node => !!node.className.match(pattern)) : fallback;
  return parent?.className.match(pattern)![1] ?? "";
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts equivalent normalized class names in the finder and result", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from "@cloudscape-design/component-toolkit/dom";
const pattern = /context-([\\w-]+)/;
const read = (element) => {
  const parent = findUpUntil(element, node => {
    const className = typeof node.className === "string" ? node.className : node.getAttribute("class") ?? "";
    return !!className.match(pattern);
  });
  if (parent) {
    const className = typeof parent.className === "string" ? parent.className : parent.getAttribute("class") ?? "";
    return className.match(pattern)![1] ?? "";
  }
  return "";
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a normalized finder result when the predicate reads another attribute", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from "@cloudscape-design/component-toolkit/dom";
const pattern = /context-([\\w-]+)/;
const read = (element) => {
  const parent = findUpUntil(element, node => {
    const className = typeof node.className === "string" ? node.className : node.getAttribute("data-class") ?? "";
    return !!className.match(pattern);
  });
  if (parent) {
    const className = typeof parent.className === "string" ? parent.className : parent.getAttribute("class") ?? "";
    return className.match(pattern)![1] ?? "";
  }
  return "";
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts find after a guarded maximum derived from the same receiver", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts) => {
  const maximum = attempts
    .filter(attempt => attempt.status === "success")
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum > 0) {
    return attempts.find(attempt => attempt.sequence === maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps find when the maximum guard admits the empty fallback", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts) => {
  const maximum = attempts
    .filter(attempt => attempt.status === "success")
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum >= 0) {
    return attempts.find(attempt => attempt.sequence === maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps find when the reducer does not compute the guarded maximum", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts) => {
  const maximum = attempts
    .filter(attempt => attempt.status === "success")
    .reduce((current, attempt) => Math.min(current, attempt.sequence), 0);
  if (maximum > 0) {
    return attempts.find(attempt => attempt.sequence === maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps find when it searches a different receiver", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts, otherAttempts) => {
  const maximum = attempts
    .filter(attempt => attempt.status === "success")
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum > 0) {
    return otherAttempts.find(attempt => attempt.sequence === maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps find when the receiver is cleared after computing the maximum", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts) => {
  const maximum = attempts
    .filter(attempt => attempt.status === "success")
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum > 0) {
    attempts.splice(0);
    return attempts.find(attempt => attempt.sequence === maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps find when the lookup excludes the guarded maximum", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts) => {
  const maximum = attempts
    .filter(attempt => attempt.status === "success")
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum > 0) {
    return attempts.find(attempt => attempt.sequence !== maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps find when an element property changes after computing the maximum", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts) => {
  const maximum = attempts
    .filter(attempt => attempt.status === "success")
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum > 0) {
    attempts[0].sequence = 0;
    return attempts.find(attempt => attempt.sequence === maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps find when an iterator mutates element properties", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts) => {
  const maximum = attempts
    .filter(attempt => attempt.status === "success")
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum > 0) {
    attempts.forEach(attempt => {
      attempt.sequence = 0;
    });
    return attempts.find(attempt => attempt.sequence === maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps find when an element alias changes after computing the maximum", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts) => {
  const maximum = attempts
    .filter(attempt => attempt.status === "success")
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum > 0) {
    const firstAttempt = attempts[0];
    firstAttempt.sequence = 0;
    return attempts.find(attempt => attempt.sequence === maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps find when an element escapes after computing the maximum", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts, mutate) => {
  const maximum = attempts
    .filter(attempt => attempt.status === "success")
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum > 0) {
    mutate(attempts[0]);
    return attempts.find(attempt => attempt.sequence === maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps find when the receiver escapes after computing the maximum", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts, mutate) => {
  const maximum = attempts
    .filter(attempt => attempt.status === "success")
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum > 0) {
    mutate(attempts);
    return attempts.find(attempt => attempt.sequence === maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps find when the filter mutates the receiver", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const settle = (attempts) => {
  const maximum = attempts
    .filter(attempt => {
      attempts.length = 0;
      return attempt.status === "success";
    })
    .reduce((current, attempt) => Math.max(current, attempt.sequence), 0);
  if (maximum > 0) {
    return attempts.find(attempt => attempt.sequence === maximum)!.value;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
