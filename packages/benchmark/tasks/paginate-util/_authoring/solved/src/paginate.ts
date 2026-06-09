export interface Page<Item> {
  items: Item[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

const clampToRange = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

export const paginate = <Item>(
  items: readonly Item[],
  page: number,
  perPage: number,
): Page<Item> => {
  const safePerPage = Math.max(1, Math.floor(perPage));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePerPage));
  const safePage = clampToRange(Math.floor(page), 1, totalPages);
  const start = (safePage - 1) * safePerPage;
  return {
    items: items.slice(start, start + safePerPage),
    page: safePage,
    perPage: safePerPage,
    totalItems,
    totalPages,
  };
};
