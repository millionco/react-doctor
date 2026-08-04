import { useActionState } from "react";

interface ActionPanelProperties {
  reducerAction: (previousState: number, payload: number) => number;
}

export const ActionPanel = ({ reducerAction }: ActionPanelProperties) => {
  const [state, dispatchAction] = useActionState(reducerAction, 0);
  return (
    <form action={() => dispatchAction(1)}>
      <button type="submit">Update</button>
      <output>{state}</output>
    </form>
  );
};
