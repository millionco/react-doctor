import { flushSync } from "react-dom";

export const updateText = (textarea: HTMLTextAreaElement, shouldUpdate: boolean): void => {
  if (shouldUpdate) flushSync(() => setText(readRemoteText()));
  textarea.focus();
};
