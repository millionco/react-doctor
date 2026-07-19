// rule: no-unguarded-throwing-parse-call
// weakness: control-flow
// source: adversarial audit of PR parsing/string-safety group

declare const proxy: (...arguments_: unknown[]) => unknown;

export const buildProxy = (allowedUrls: string[]): unknown =>
  proxy((request: { query: { url: string } }) => new URL(request.query.url).origin, {
    filter: (request: { query: { url: string } }) => allowedUrls.includes(request.query.url),
  });
