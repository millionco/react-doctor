interface ListProperties {
  items: string[];
}

export const List = ({ items }: ListProperties) => {
  items.sort();
  return <p>{items.join(", ")}</p>;
};
