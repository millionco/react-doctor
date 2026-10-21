// rule: rules-of-hooks
// weakness: library-idiom
// source: synthetic API-role regression
// verdict: pass
import { createFormHook } from "@tanstack/react-form";
import { useState } from "react";

const { withForm } = createFormHook({});
const FormPanel = withForm({
  render: () => {
    const [label] = useState("");
    return <span>{label}</span>;
  },
});

export const Page = () => <FormPanel />;
