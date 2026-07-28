interface FormShellProperties {
  action: (formData: FormData) => void;
}

export const FormShell = ({ action }: FormShellProperties) => (
  <form action={action}>
    <button type="submit">Submit</button>
  </form>
);
