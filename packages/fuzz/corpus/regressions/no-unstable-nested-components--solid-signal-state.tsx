// rule: no-unstable-nested-components
// weakness: framework-gating
// source: React Bench migrate-react-opencode-solid-to__qkdAxyJ
import { createSignal, Show } from "solid-js";

export const DialogConnectProvider = () => {
  const ProviderOption = (props: { name: string }) => {
    const [attempts, setAttempts] = createSignal(0);
    return (
      <button onClick={() => setAttempts(attempts() + 1)}>
        {props.name}: {attempts()}
      </button>
    );
  };

  return (
    <Show when={true}>
      <ProviderOption name="OpenCode" />
    </Show>
  );
};
