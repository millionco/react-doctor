// rule: no-locale-format-in-render
// weakness: alias-guard
// source: react-bench oracle patch reported by user

"use client";

export const Timestamp = ({
  value,
  locale,
  timeZone,
}: {
  value: string;
  locale: string;
  timeZone: string;
}) => {
  const options = { dateStyle: "medium", timeZone } as const;
  return <time>{new Date(value).toLocaleString(locale, options)}</time>;
};
