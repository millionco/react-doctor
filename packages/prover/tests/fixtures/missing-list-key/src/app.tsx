interface ListProperties {
  items: ReadonlyArray<string>;
}

export const List = ({ items }: ListProperties) => (
  <ul>
    {items.map((item) => (
      <li>{item}</li>
    ))}
  </ul>
);
