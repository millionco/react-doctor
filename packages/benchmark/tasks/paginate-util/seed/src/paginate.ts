export interface Page<Item> {
  items: Item[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

// TODO(agent): implement. See instruction.md.
export const paginate = <Item>(
  _items: readonly Item[],
  _page: number,
  _perPage: number,
): Page<Item> => {
  throw new Error("not implemented");
};
