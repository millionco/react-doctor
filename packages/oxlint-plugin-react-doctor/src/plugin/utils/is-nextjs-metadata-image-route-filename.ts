import * as path from "node:path";
import { NEXTJS_SOURCE_FILE_EXTENSION_GROUP } from "../constants/nextjs.js";

const METADATA_IMAGE_ROUTE_FILE_PATTERN = new RegExp(
  `^(opengraph-image|twitter-image|icon|apple-icon)\\d*\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);

// Next.js App Router metadata image route conventions. These files look
// like React components but their default export returns an
// `ImageResponse` from `next/og` that rasterizes JSX into a static
// PNG / JPG served at `/opengraph-image`, `/twitter-image`, `/icon`,
// or `/apple-icon`. The output never reaches a browser DOM — it's
// consumed by social-media crawlers and the favicon stack — so DOM-
// flavoured a11y semantics (alt text, ARIA roles, keyboard focus)
// don't apply and rules that enforce them produce unactionable noise.
//
// Per the Next.js convention each basename is also valid with an
// optional trailing numeric suffix (`opengraph-image1.tsx`,
// `apple-icon0.tsx`) to register multiple metadata images for a
// single route segment.
//
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata
export const isNextjsMetadataImageRouteFilename = (rawFilename: string | undefined): boolean => {
  if (!rawFilename) return false;
  return METADATA_IMAGE_ROUTE_FILE_PATTERN.test(path.basename(rawFilename));
};
