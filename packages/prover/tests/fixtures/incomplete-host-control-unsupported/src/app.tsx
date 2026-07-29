import { useState } from "react";
import type { ChangeEvent } from "react";

interface AppProperties {
  inputType: "number" | "text";
}

export const App = ({ inputType }: AppProperties) => {
  const [fileName, setFileName] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [regions, setRegions] = useState<ReadonlyArray<string>>([]);
  return (
    <form>
      <input
        type="file"
        value={fileName}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setFileName(event.currentTarget.value)}
      />
      <select
        multiple
        value={regions}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          setRegions([event.currentTarget.value])
        }
      >
        <option value="north">North</option>
        <option value="south">South</option>
      </select>
      <input
        type={inputType}
        value={inputValue}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          setInputValue(event.currentTarget.value)
        }
      />
    </form>
  );
};
