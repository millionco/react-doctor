// verdict: pass
// rule: nextjs-no-side-effect-in-get-handler
// weakness: copy-tracking
// source: GitHub issue #1808
// file-path: app/api/download/route.ts

function downloadHeaders({
  filename,
  contentType,
  contentLength,
}: {
  filename: string;
  contentType: string;
  contentLength?: string | null;
}): Headers {
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  if (contentLength) headers.set("Content-Length", contentLength);
  return headers;
}

export async function GET(request: Request) {
  const denied = await authorize();
  if (denied) return denied;
  const upstream = await fetch("https://example.com");
  return new Response(upstream.body, {
    headers: downloadHeaders({ filename: "x", contentType: "video/mp4", contentLength: "123" }),
  });
}

declare function authorize(): Promise<Response | null>;
