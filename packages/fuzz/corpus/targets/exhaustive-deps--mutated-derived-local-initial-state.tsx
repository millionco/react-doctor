import { useEffect, useState } from "react";

export const Image = ({
  value,
  retryError,
  setError,
}: {
  value?: string;
  retryError: Error;
  setError: (error: Error | undefined) => void;
}) => {
  let valueError: Error | undefined;
  if (!value) valueError = new Error("No value found for property.");
  useState((valueError!.cause = retryError));
  useEffect(() => {
    setError(valueError);
  }, [value]);
  return null;
};
