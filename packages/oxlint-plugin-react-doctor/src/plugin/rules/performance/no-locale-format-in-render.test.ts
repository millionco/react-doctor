// RD-FN-062: locale/timezone-dependent formatting evaluated during render
// on an SSR page formats with the server's locale/timezone in the HTML and
// the user's on hydration — a guaranteed mismatch. The SSR-safe inverse
// (formatting in a post-mount effect) must stay quiet: this rule is the
// mirror of the pattern the derived-state family used to false-positive on.

import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLocaleFormatInRender } from "./no-locale-format-in-render.js";

const run = (code: string, filename = "app/settings.tsx") =>
  runRule(noLocaleFormatInRender, code, { filename });

describe("no-locale-format-in-render — render-phase locale formatting", () => {
  it("flags toLocaleString inside a useMemo row builder (ground-truth shape)", () => {
    const result = run(
      `import { useMemo } from "react";
export const SettingsPage = ({ apiKeys }) => {
  const apiKeyRows = useMemo(
    () =>
      apiKeys.map((apiKey) => [
        apiKey.name,
        apiKey.createdAt ? new Date(apiKey.createdAt).toLocaleString() : "",
      ]),
    [apiKeys],
  );
  return <Table rows={apiKeyRows} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("toLocaleString()");
  });

  it("flags toLocaleDateString directly inside JSX", () => {
    const result = run(
      `import { useState } from "react";
export const Row = ({ createdAt }) => {
  const [expanded, setExpanded] = useState(false);
  return <td onClick={() => setExpanded(!expanded)}>{new Date(createdAt).toLocaleDateString()}</td>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Intl.DateTimeFormat().format() in a render-body const", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => {
  const label = new Intl.DateTimeFormat().format(new Date(value));
  return <time>{label}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Intl.DateTimeFormat()");
  });

  it("flags a const-bound Intl formatter used later in render", () => {
    const result = run(
      `"use client";
export const Stamp = ({ value }) => {
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag Intl.NumberFormat in render (locale-only grouping mismatch is too weak a signal)", () => {
    const result = run(
      `"use client";
export const Count = ({ total }) => <span>{new Intl.NumberFormat().format(total)}</span>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a locale call inside a custom hook's render path", () => {
    const result = run(
      `import { useMemo } from "react";
export function useFormattedDeadline(deadline) {
  return useMemo(() => new Date(deadline).toLocaleString(), [deadline]);
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags date default stringification via template literal in JSX", () => {
    const result = run(
      `"use client";
export const Debug = ({ ts }) => <pre>{\`created \${new Date(ts)}\`}</pre>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a same-file helper called from JSX (depth-1 resolution)", () => {
    const result = run(
      `"use client";
const formatCreatedAt = (createdAt) => new Date(createdAt).toLocaleString();
export const Row = ({ createdAt }) => <td>{formatCreatedAt(createdAt)}</td>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("formatCreatedAt");
  });

  it("does not flag formatting inside a post-mount effect (the SSR-safe inverse pattern)", () => {
    const result = run(
      `import { useEffect, useState } from "react";
export const Timestamp = ({ value }) => {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(new Date(value).toLocaleString());
  }, [value]);
  return <time>{label}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag the FP-007 timezone-adoption effect (Intl in an effect)", () => {
    const result = run(
      `import { useEffect, useState } from "react";
export const Clock = ({ utcTime }) => {
  const [zone, setZone] = useState("UTC");
  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  return <time>{utcTime} {zone}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag formatting inside an event handler", () => {
    const result = run(
      `import { useState } from "react";
export const ExportButton = ({ rows }) => {
  const [busy, setBusy] = useState(false);
  const onExport = () => {
    setBusy(true);
    download(rows.map((row) => new Date(row.at).toLocaleString()).join("\\n"));
  };
  return <button onClick={onExport} disabled={busy}>Export</button>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag formatting inside a useCallback body", () => {
    const result = run(
      `import { useCallback, useState } from "react";
export const Grid = () => {
  const [rows] = useState([]);
  const buildCsv = useCallback(
    () => rows.map((row) => new Date(row.at).toLocaleDateString()).join(","),
    [rows],
  );
  return <ExportButton onExport={buildCsv} />;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag deterministic explicit locale + timeZone", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => (
  <time>{new Date(value).toLocaleString("en-US", { timeZone: "UTC" })}</time>
);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag deterministic Intl options through a const alias", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale, resolvedTimeZone }) => {
  const options = { dateStyle: "medium", timeZone: resolvedTimeZone };
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust mutable Intl option aliases", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale, resolvedTimeZone }) => {
  let options = { dateStyle: "medium", timeZone: resolvedTimeZone };
  options = getCurrentOptions(options);
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag frozen deterministic Intl options", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = Object.freeze({ dateStyle: "medium", timeZone: "UTC" });
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a conditional whose branches both set timeZone", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale, useUtc }) => {
  const options = useUtc ? { timeZone: "UTC" } : { timeZone: "America/New_York" };
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "member mutation before construction",
      `const options = { timeZone: "UTC" };
       options.timeZone = undefined;`,
    ],
    [
      "property deletion before construction",
      `const options = { timeZone: "UTC" };
       delete options.timeZone;`,
    ],
    [
      "mutation through a nested const alias",
      `const baseOptions = { timeZone: "UTC" };
       const options = baseOptions;
       options.timeZone = undefined;`,
    ],
    [
      "a mutation through a TypeScript wrapper",
      `const options = { timeZone: "UTC" };
       (options as Intl.DateTimeFormatOptions).timeZone = undefined;`,
    ],
    [
      "a destructured const binding",
      `const source = { timeZone: "UTC", options: { dateStyle: "medium" } };
       const { options } = source;`,
    ],
    [
      "passing the options object to an unknown function",
      `const options = { timeZone: "UTC" };
       inspect(options);`,
    ],
    [
      "an array destructuring write",
      `const options = { timeZone: "UTC" };
       [options.timeZone] = [undefined];`,
    ],
    [
      "an object destructuring write",
      `const options = { timeZone: "UTC" };
       ({ timeZone: options.timeZone } = { timeZone: undefined });`,
    ],
    [
      "a destructuring for-of write",
      `const options = { timeZone: "UTC" };
       for ([options.timeZone] of [[undefined]]) {}`,
    ],
    [
      "a mutation through a secondary const alias",
      `const options = { timeZone: "UTC" };
       const alias = options;
       delete alias.timeZone;`,
    ],
    [
      "a mutation through an assigned alias",
      `const options = { timeZone: "UTC" };
       let alias;
       alias = options;
       alias.timeZone = undefined;`,
    ],
    [
      "storage in a mutable member alias",
      `const options = { timeZone: "UTC" };
       const holder = {};
       holder.options = options;
       delete holder.options.timeZone;`,
    ],
    ["an unknown trailing spread", `const options = { timeZone: "UTC", ...overrides };`],
    [
      "a final undefined duplicate property",
      `const options = { timeZone: "UTC", timeZone: undefined };`,
    ],
  ])("flags options invalidated by %s", (_name, optionSetup) => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale, overrides }) => {
  ${optionSetup}
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a trailing explicit timeZone after an unknown spread", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale, overrides }) => {
  const options = { ...overrides, timeZone: "UTC" };
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not let nullish spreads override an explicit timeZone proof", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const missing = undefined;
  const options = { timeZone: "UTC", ...null, ...missing };
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not let primitive spreads override an explicit timeZone proof", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC", ...false, ...42, ..."text" };
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat read-only option property uses as mutation", () => {
    const result = run(
      `"use client";
const consume = (value) => value;
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  consume(options.timeZone);
  options.timeZone.toLowerCase();
  options.hasOwnProperty("timeZone");
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a read-only secondary alias as mutation", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  const alias = options;
  alias.timeZone.toLowerCase();
  alias.hasOwnProperty("timeZone");
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat identity aliases on the formatter path as escapes", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const baseOptions = { timeZone: "UTC" };
  const intermediateOptions = baseOptions;
  const options = intermediateOptions;
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still tracks mutations through aliases outside the formatter path", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const baseOptions = { timeZone: "UTC" };
  const options = baseOptions;
  const mutableAlias = baseOptions;
  mutableAlias.timeZone = undefined;
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat read-only destructuring as mutation", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  const { timeZone, ...remainingOptions } = options;
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time data-zone={timeZone} data-options={remainingOptions}>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still tracks mutations inside destructuring defaults", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  const { missing = (options.timeZone = undefined) } = {};
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time data-missing={missing}>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a mutation evaluated in an earlier formatter argument", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => {
  const options = { timeZone: "UTC" };
  const formatter = new Intl.DateTimeFormat(
    (options.timeZone = undefined, "en-US"),
    options,
  );
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a direct options alias mutated in a later formatter argument", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => {
  const options = { timeZone: "UTC" };
  const formatter = new Intl.DateTimeFormat("en-US", options, options.timeZone = undefined);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an options alias mutated by a helper in a formatter argument", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => {
  const options = { timeZone: "UTC" };
  const formatter = new Intl.DateTimeFormat((clearTimeZone(), "en-US"), options);
  return <time>{formatter.format(new Date(value))}</time>;

  function clearTimeZone() {
    options.timeZone = undefined;
  }
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves the formatter boundary through an identity alias", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => {
  const baseOptions = { timeZone: "UTC" };
  const options = baseOptions;
  const formatter = new Intl.DateTimeFormat(
    (baseOptions.timeZone = undefined, "en-US"),
    options,
  );
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves the formatter boundary while following a secondary alias", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => {
  const options = { timeZone: "UTC" };
  const alias = options;
  const formatter = new Intl.DateTimeFormat("en-US", options, alias.timeZone = undefined);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a spread snapshot deterministic when its source is mutated afterward", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => {
  const options = { timeZone: "UTC" };
  const formatter = new Intl.DateTimeFormat("en-US", {
    ...options,
    marker: (options.timeZone = undefined),
  });
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a spread snapshot deterministic when a later property calls a mutating helper", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => {
  const options = { timeZone: "UTC" };
  const formatter = new Intl.DateTimeFormat("en-US", {
    ...options,
    marker: clearTimeZone(),
  });
  return <time>{formatter.format(new Date(value))}</time>;

  function clearTimeZone() {
    options.timeZone = undefined;
  }
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a spread source mutated by an earlier property helper", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => {
  const options = { timeZone: "UTC" };
  const formatter = new Intl.DateTimeFormat("en-US", {
    marker: clearTimeZone(),
    ...options,
  });
  return <time>{formatter.format(new Date(value))}</time>;

  function clearTimeZone() {
    options.timeZone = undefined;
  }
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a mutation in a later-declared helper invoked before construction", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  clearTimeZone();
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;

  function clearTimeZone() {
    options.timeZone = undefined;
  }
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a deferred callback mutation as render-time mutation", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  useEffect(() => {
    options.timeZone = undefined;
  }, []);
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a named deferred helper as render-time mutation", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  useEffect(clearTimeZone, []);
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;

  function clearTimeZone() {
    options.timeZone = undefined;
  }
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a helper invoked after construction as an earlier mutation", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  const formatter = new Intl.DateTimeFormat(locale, options);
  clearTimeZone();
  return <time>{formatter.format(new Date(value))}</time>;

  function clearTimeZone() {
    options.timeZone = undefined;
  }
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a mutation reached through a synchronous helper chain", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  prepareOptions();
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;

  function prepareOptions() {
    clearTimeZone();
  }

  function clearTimeZone() {
    options.timeZone = undefined;
  }
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a mutation in a synchronously invoked object method", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  const helper = {
    clearTimeZone() {
      options.timeZone = undefined;
    },
  };
  const alias = helper;
  alias.clearTimeZone();
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a deferred object method call as render-time mutation", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  const helper = {
    clearTimeZone() {
      options.timeZone = undefined;
    },
  };
  useEffect(() => helper.clearTimeZone(), []);
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not match a same-named method on an unrelated object", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  const mutatingHelper = {
    clearTimeZone() {
      options.timeZone = undefined;
    },
  };
  const readOnlyHelper = { clearTimeZone() {} };
  readOnlyHelper.clearTimeZone();
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a mutation in a synchronously invoked class method", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  class Helper {
    clearTimeZone() {
      options.timeZone = undefined;
    }
  }
  const helper = new Helper();
  const alias = helper;
  alias.clearTimeZone();
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a mutation in a synchronously invoked static method", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  class Helper {
    static clearTimeZone() {
      options.timeZone = undefined;
    }
  }
  const HelperAlias = Helper;
  HelperAlias.clearTimeZone();
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a module-scope mutation before component rendering", () => {
    const result = run(
      `"use client";
const options = { timeZone: "UTC" };

export const Timestamp = ({ value, locale }) => {
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};

options.timeZone = undefined;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves a spread snapshot created before its source is mutated", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const baseOptions = { timeZone: "UTC" };
  const options = { ...baseOptions };
  baseOptions.timeZone = undefined;
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves a spread snapshot before a helper mutates its source", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const baseOptions = { timeZone: "UTC" };
  const options = { ...baseOptions };
  clearTimeZone();
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;

  function clearTimeZone() {
    baseOptions.timeZone = undefined;
  }
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a mutation in an IIFE invoked before construction", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  (() => {
    options.timeZone = undefined;
  })();
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a deferred IIFE as a render-time mutation", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const options = { timeZone: "UTC" };
  useEffect(() => {
    (() => {
      options.timeZone = undefined;
    })();
  }, []);
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a trailing spread whose timeZone is undefined", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const overrides = { timeZone: undefined };
  const options = { timeZone: "UTC", ...overrides };
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline timeZone overridden by an unknown spread", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale, overrides }) => (
  <time>{new Date(value).toLocaleString(locale, { timeZone: "UTC", ...overrides })}</time>
);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline statically undefined timeZone", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => (
  <time>{new Date(value).toLocaleString(locale, { timeZone: void 0 })}</time>
);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a timeZone set through a const undefined alias", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const missingTimeZone = undefined;
  const timeZone = missingTimeZone;
  const options = { timeZone };
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not confuse a shadowed undefined binding with undefined", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value, locale }) => {
  const undefined = "UTC";
  const timeZone = undefined;
  const options = { timeZone };
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes a shadowed undefined locale as explicit", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => {
  const undefined = "en-US";
  return <time>{new Date(value).toLocaleString(undefined, { timeZone: "UTC" })}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an explicit locale WITHOUT a timeZone on a provable date", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => <time>{new Date(value).toLocaleString("en-US")}</time>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag toLocaleString with an explicit locale on an unknown receiver (could be a number)", () => {
    const result = run(
      `"use client";
export const Count = ({ total }) => <span>{total.toLocaleString("en-US")}</span>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag bare toLocaleString on a number-shaped receiver (grouping-only mismatch is too weak a signal)", () => {
    const result = run(
      `"use client";
export const Count = ({ total }) => <span>{total.toLocaleString()}</span>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags bare toLocaleString on a date-flavored receiver name", () => {
    const result = run(
      `"use client";
export const Row = ({ item }) => <td>{item.createdAt.toLocaleString()}</td>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags bare toLocaleString on a date-flavored identifier", () => {
    const result = run(
      `"use client";
export const Row = ({ deadline }) => <td>{deadline.toLocaleString()}</td>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag explicit-locale Intl.NumberFormat either", () => {
    const result = run(
      `"use client";
export const Price = ({ amount }) => (
  <span>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)}</span>
);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a value gated behind a mounted flag ternary", () => {
    const result = run(
      `import { useEffect, useState } from "react";
export const Timestamp = ({ value }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <time>{mounted ? new Date(value).toLocaleString() : null}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag formatting after a mounted-flag early return", () => {
    const result = run(
      `import { useEffect, useState } from "react";
export const Timestamp = ({ value }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const label = new Date(value).toLocaleString();
  return <time>{label}</time>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag under suppressHydrationWarning", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => (
  <time suppressHydrationWarning>{new Date(value).toLocaleString()}</time>
);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a hook-free component with no use client directive (server component)", () => {
    const result = run(
      `export const ServerTimestamp = ({ value }) => (
  <time>{new Date(value).toLocaleString()}</time>
);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag inside getServerSideProps (serialized value is identical on both sides)", () => {
    const result = run(
      `export const getServerSideProps = async () => {
  const generatedAt = new Date().toLocaleString();
  return { props: { generatedAt } };
};
export default function Page({ generatedAt }) {
  return <footer>{generatedAt}</footer>;
}`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag in testlike files", () => {
    const result = run(
      `"use client";
export const Timestamp = ({ value }) => <time>{new Date(value).toLocaleString()}</time>;`,
      "app/timestamp.test.tsx",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not double-report a helper reached from two JSX call sites", () => {
    const result = run(
      `"use client";
const formatCreatedAt = (createdAt) => new Date(createdAt).toLocaleString();
export const Rows = ({ a, b }) => (
  <tr>
    <td>{formatCreatedAt(a)}</td>
    <td>{formatCreatedAt(b)}</td>
  </tr>
);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
