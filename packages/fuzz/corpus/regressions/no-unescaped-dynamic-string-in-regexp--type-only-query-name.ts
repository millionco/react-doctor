// rule: no-unescaped-dynamic-string-in-regexp
// weakness: type-wrapper
// source: local RDE validation (PostHog notebook backlinks)
interface QueryModel {
  shortId: string;
}

declare const urls: {
  insightView: (identifier: QueryModel["shortId"]) => string;
};

export const matcher = new RegExp(urls.insightView("([^/]+)" as QueryModel["shortId"]));
