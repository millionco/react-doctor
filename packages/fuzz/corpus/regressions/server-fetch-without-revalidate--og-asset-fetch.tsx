// rule: server-fetch-without-revalidate
// weakness: library-idiom
// source: fresh modern-corpus FP hunt (next/og static-asset fetch + Remix app/ routes)
import { ImageResponse } from "next/og";

export async function GET(request: Request) {
  const fontMonoRegular = await fetch(
    new URL("../../public/fonts/RobotoMono-Regular.ttf", import.meta.url),
  ).then((res) => res.arrayBuffer());
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") ?? "Status";
  return new ImageResponse(<div style={{ fontFamily: "Roboto Mono" }}>{title}</div>, {
    fonts: [{ name: "Roboto Mono", data: fontMonoRegular, style: "normal" }],
  });
}
