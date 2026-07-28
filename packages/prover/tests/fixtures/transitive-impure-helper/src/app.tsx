import { createId } from "./create-id.js";

export const Form = () => {
  const formId = createId();
  return <form id={formId} />;
};
