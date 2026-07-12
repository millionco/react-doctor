// rule: no-locale-format-in-render
// weakness: alias-guard
// source: react-bench Webstudio oracle patch
"use client";

export const Timestamp = ({ value, locale, resolvedTimeZone }) => {
  const options = { dateStyle: "medium", timeZone: resolvedTimeZone };
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};
