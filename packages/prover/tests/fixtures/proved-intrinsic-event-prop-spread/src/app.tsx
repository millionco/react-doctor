interface ButtonProperties {
  onClick: () => void;
}

const Button = (properties: ButtonProperties) => (
  <button type="button" {...properties}>
    Activate
  </button>
);

export const Application = () => {
  const handleClick = () => undefined;
  return <Button onClick={handleClick} />;
};
