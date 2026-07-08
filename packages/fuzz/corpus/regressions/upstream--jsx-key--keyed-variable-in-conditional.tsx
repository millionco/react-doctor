// rule: useJsxKeyInIterable
// weakness: copy-tracking
// source: biomejs/biome#2590 (keyed JSX stored in a variable then returned via conditional)
interface Item {
  id: string;
  condition: boolean;
}

export const Test = ({ items }: { items: Item[] }) =>
  items.map((item) => {
    const div = <div key={item.id} />;

    return item.condition ? div : <div key={item.id}>{div}</div>;
  });

export const Test2 = ({ items }: { items: Item[] }) =>
  items.map((item) => {
    const div = <div key={item.id} />;

    return <>{item.condition ? div : <div key={item.id}>{div}</div>}</>;
  });
