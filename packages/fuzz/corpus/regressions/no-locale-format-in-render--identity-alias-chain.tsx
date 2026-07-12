// rule: no-locale-format-in-render
// weakness: alias-guard
// source: Cursor Bugbot review on PR 1176

"use client";

export const Timestamp = ({ value, locale }: { value: string; locale: string }) => {
  const baseOptions = { timeZone: "UTC" };
  const intermediateOptions = baseOptions;
  const options = intermediateOptions;
  const formatter = new Intl.DateTimeFormat(locale, options);
  return <time>{formatter.format(new Date(value))}</time>;
};
