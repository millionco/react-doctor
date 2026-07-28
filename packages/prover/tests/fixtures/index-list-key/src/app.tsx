interface ListProperties {
  items: ReadonlyArray<string>;
}

export const List = ({ items }: ListProperties) => (
  <ul>
    {items.map((item, itemIndex) => (
      <li key={itemIndex}>{item}</li>
    ))}
  </ul>
);
