interface DynamicSubmitterProperties {
  buttonType: "button" | "submit";
}

export const DynamicSubmitter = ({ buttonType }: DynamicSubmitterProperties) => {
  const action = () => {};

  return (
    <form>
      <button type={buttonType} formAction={action}>
        Submit
      </button>
    </form>
  );
};
