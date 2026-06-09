import { slugify } from "./slugify.ts";

interface ArticleLinkProps {
  title: string;
}

// Existing consumer (keeps slugify.ts reachable). Do not edit.
export const ArticleLink = ({ title }: ArticleLinkProps) => (
  <a href={`/articles/${slugify(title)}`}>{title}</a>
);
