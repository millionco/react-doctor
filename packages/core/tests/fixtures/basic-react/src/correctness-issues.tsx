const IndexKeyList = ({ items }: { items: string[] }) => (
  <ul>
    {items.map((item, index) => (
      <li key={index}>{item}</li>
    ))}
  </ul>
);

const ConditionalRenderBug = ({ items }: { items: string[] }) => (
  <div>
    {items.length && (
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )}
  </div>
);

const PreventDefaultLink = () => (
  <a
    href="#"
    onClick={(event) => {
      event.preventDefault();
    }}
  >
    Next
  </a>
);

export { IndexKeyList, ConditionalRenderBug, PreventDefaultLink };
