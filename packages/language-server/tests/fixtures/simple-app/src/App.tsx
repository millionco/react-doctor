interface AppProps {
  items: string[];
}

export const App = ({ items }: AppProps) => {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={index} style={{ color: "red" }}>
          {item}
        </li>
      ))}
    </ul>
  );
};
