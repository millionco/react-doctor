import { useFormStatus } from "react-dom";

interface SubmitButtonProperties {
  label: string;
}

const SubmitButton = ({ label }: SubmitButtonProperties) => {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? `Submitting ${label}` : label}
    </button>
  );
};

const submitBatch = () => {};

export const BatchForm = () => (
  <form action={submitBatch}>
    {["primary", "secondary"].map((label) => (
      <SubmitButton key={label} label={label} />
    ))}
  </form>
);
