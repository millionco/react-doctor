// rule: rendering-usetransition-loading
// weakness: library-idiom
// source: react-bench trials 2ZDe7cD and 8yX8GyT

import { useState } from "react";

export const FileUpload = ({ file }: { file: File }) => {
  const [isLoading, setIsLoading] = useState(false);

  const readFile = () => {
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = () => {
      setIsLoading(false);
    };
    reader.onerror = () => {
      setIsLoading(false);
    };
    reader.readAsText(file);
  };

  return (
    <button type="button" onClick={readFile}>
      {isLoading ? "Reading" : "Upload"}
    </button>
  );
};
