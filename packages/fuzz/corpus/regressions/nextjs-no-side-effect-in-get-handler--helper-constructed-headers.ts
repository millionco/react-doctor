// verdict: pass
// rule: nextjs-no-side-effect-in-get-handler
// weakness: receiver-provenance
// source: GitHub issue #1808
// file-path: app/api/download/route.ts

declare function authorize(): Promise<Response | null>;

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

export async function GET() {
  const denied = await authorize();
  if (denied) return denied;
  const upstream = await fetch("https://cdn.example.com/video.mp4");
  return new Response(upstream.body, {
    headers: downloadHeaders({ filename: "x", contentType: "video/mp4", contentLength: "123" }),
  });
}
