import { useDelivery } from "./delivery";
import validate from "./validator";
import { Form } from "./controls";

export const Editor = () => {
  const { submit, address } = useDelivery(validate);
  return (
    <Form onSubmit={submit}>
      <input value={address} readOnly />
      <button type="submit">Send</button>
    </Form>
  );
};
