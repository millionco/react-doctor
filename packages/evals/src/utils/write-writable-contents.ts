import type { Writable } from "node:stream";

export const writeWritableContents = async (output: Writable, contents: string): Promise<void> =>
  new Promise((resolve, reject) => {
    let isSettled = false;
    const handleError = (error: Error) => {
      if (isSettled) return;
      isSettled = true;
      reject(error);
    };
    output.once("error", handleError);
    try {
      output.write(contents, (error) => {
        if (error) {
          handleError(error);
          return;
        }
        if (isSettled) return;
        isSettled = true;
        output.off("error", handleError);
        resolve();
      });
    } catch (error) {
      output.off("error", handleError);
      handleError(error instanceof Error ? error : new Error(String(error)));
    }
  });
