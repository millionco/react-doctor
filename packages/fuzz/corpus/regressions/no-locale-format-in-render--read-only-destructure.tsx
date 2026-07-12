// rule: no-locale-format-in-render
// weakness: alias-guard
// source: Cursor Bugbot review on PR 1176

"use client";

export const Timestamp = ({ value, locale }: { value: string; locale: string }) => {
  const options = { timeZone: "UTC" };
  const { timeZone, ...remainingOptions } = options;
  const formatter = new Intl.DateTimeFormat(locale, options);
  return (
    <time data-zone={timeZone} data-options={remainingOptions}>
      {formatter.format(new Date(value))}
    </time>
  );
};
