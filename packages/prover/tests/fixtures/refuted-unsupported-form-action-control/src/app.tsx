export const UnsupportedActionControl = () => {
  const action = () => {};

  return <div action={action}>Cannot submit</div>;
};
