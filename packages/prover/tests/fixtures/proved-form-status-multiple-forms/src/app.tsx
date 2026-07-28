import * as ReactDOM from "react-dom";

const SubmitButton = () => {
  const { pending } = ReactDOM.useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Submitting" : "Submit"}
    </button>
  );
};

const submitProfile = (formData: FormData) => {
  String(formData.get("profile"));
};

export const Settings = () => (
  <>
    <form action={submitProfile}>
      <input aria-label="Primary profile" name="profile" value="primary" readOnly />
      <SubmitButton />
    </form>
    <form action={submitProfile}>
      <input aria-label="Backup profile" name="profile" value="backup" readOnly />
      <SubmitButton />
    </form>
  </>
);
