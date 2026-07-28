import { use } from "react";

interface MessageProperties {
  resource: PromiseLike<string>;
}

export const Message = ({ resource }: MessageProperties) => {
  try {
    const message = use(resource);
    return <p>{message}</p>;
  } catch {
    return null;
  }
};
