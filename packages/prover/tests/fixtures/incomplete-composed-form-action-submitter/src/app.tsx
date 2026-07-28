export const ComposedSubmitter = () => {
  const action = () => {};

  return (
    <button type="submit" formAction={action}>
      Submit
    </button>
  );
};
