interface Props {
  items?: string[];
  glyphs?: Record<string, string>;
}

export const buildCollections = ({ items = ["fallback"], glyphs = {} }: Props) => ({
  items: items.reduce<string[]>((accumulator, item) => [...accumulator, item], []),
  glyphs: Object.keys(glyphs).reduce<string[]>((accumulator, key) => [...accumulator, key], []),
});
