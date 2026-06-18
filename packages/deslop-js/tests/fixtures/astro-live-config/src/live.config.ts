import { defineLiveCollection } from "astro:content";
import { createWordPressLoader } from "./loaders/wordpress-loader";

const pages = defineLiveCollection({
  loader: createWordPressLoader({ pageType: "generic" }),
});

export const collections = { pages };
