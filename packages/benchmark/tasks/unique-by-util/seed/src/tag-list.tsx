import { uniqueBy } from "./unique-by.ts";

interface Tag {
  id: string;
  label: string;
}

interface TagListProps {
  tags: Tag[];
}

// Existing consumer (keeps unique-by.ts reachable). Do not edit.
export const TagList = ({ tags }: TagListProps) => (
  <span>{uniqueBy(tags, (tag) => tag.label).length} unique</span>
);
