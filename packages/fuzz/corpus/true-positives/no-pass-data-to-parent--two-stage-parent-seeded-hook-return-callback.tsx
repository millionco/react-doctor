// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useEffect } from "react";
import { useForm, readValue } from "form-library";
export function Child({ initial }) {
  const methods = useForm({ defaultValues: initial });
  const { reset } = methods;
  const value = readValue();
  useEffect(() => {
    reset(value);
  }, [value, reset]);
  return null;
}
