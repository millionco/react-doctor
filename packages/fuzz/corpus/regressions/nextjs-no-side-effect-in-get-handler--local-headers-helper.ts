// verdict: pass
// rule: nextjs-no-side-effect-in-get-handler
// weakness: copy-tracking
// source: GitHub issue #1757
// file-path: src/app/api/proxy/route.ts

const applyCachePolicy = (responseHeaders: Headers) => {
  responseHeaders.set("Cache-Control", "max-age=60");
};

export const GET = () => {
  const responseHeaders = new Headers();
  applyCachePolicy(responseHeaders);
  return new Response(null, { headers: responseHeaders });
};
