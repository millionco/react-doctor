import { use } from "react";

interface MessageProperties {
  resource: PromiseLike<string>;
  shouldRead: boolean;
}

export const Message = ({ resource, shouldRead }: MessageProperties) => {
  if (!shouldRead) return null;
  const message = use(resource);
  return <p>{message}</p>;
};
