import type { ChangeEvent } from "react";

interface InputProperties {
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  value?: string;
}

interface AppProperties {
  inputProperties: InputProperties;
}

export const App = ({ inputProperties }: AppProperties) => <input {...inputProperties} />;
