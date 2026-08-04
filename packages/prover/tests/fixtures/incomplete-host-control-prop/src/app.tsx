import type { ChangeEvent } from "react";

interface AppProperties {
  name: string;
  onNameChange: (name: string) => void;
}

export const App = ({ name, onNameChange }: AppProperties) => (
  <input
    value={name}
    onChange={(event: ChangeEvent<HTMLInputElement>) => onNameChange(event.currentTarget.value)}
  />
);
