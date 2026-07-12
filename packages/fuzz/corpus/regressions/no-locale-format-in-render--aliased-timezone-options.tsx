// rule: no-locale-format-in-render
// weakness: alias-guard
// source: react-bench Webstudio oracle patch
"use client";

const locale = "en-US";
const options = { dateStyle: "medium", timeZone: "UTC" };
const formatter = new Intl.DateTimeFormat(locale, options);

export const Timestamp = () => <time>{formatter.format(new Date(0))}</time>;
