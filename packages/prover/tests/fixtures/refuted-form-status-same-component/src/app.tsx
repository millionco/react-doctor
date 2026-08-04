import { useFormStatus } from "react-dom";

const saveProfile = (formData: FormData) => {
  String(formData.get("name"));
};

export const ProfileForm = () => {
  const { pending } = useFormStatus();
  return (
    <form action={saveProfile}>
      <label>
        Name
        <input name="name" />
      </label>
      <button type="submit" disabled={pending}>
        Save profile
      </button>
    </form>
  );
};
