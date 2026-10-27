// rule: no-async-event-handler-without-reentry-guard
// weakness: cross-file
// source: Synthetic owned Hook with a pure validator and changed admission data
// verdict: pass
import { useState } from "react";

export const useDelivery = (validate) => {
  const [form, setForm] = useState({
    values: { address: "reader@example.invalid", message: "Hello", ready: true },
    issues: {},
  });
  const submit = async (event) => {
    event.preventDefault();
    const values = form.values;
    const issues = validate(values);
    setForm((previous) => ({ ...previous, values: { ...previous.values, ready: false } }));
    if (Object.values(issues).every((issue) => issue === "")) {
      const response = await fetch("/deliveries", { method: "POST" });
      if (response.ok) setForm({ values: { address: "", message: "", ready: true }, issues: {} });
    }
  };
  return { submit, address: form.values.address };
};
