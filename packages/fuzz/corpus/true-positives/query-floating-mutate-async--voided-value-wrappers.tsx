// rule: query-floating-mutate-async
// weakness: wrapper-transparency
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const SaveButton = ({ enabled, payload }: { enabled: boolean; payload: Payload }) => {
  const mutation = useMutation({ mutationFn: savePayload });

  const handleClick = () => {
    void (mutation.mutateAsync(payload) ?? fallbackPromise);
    void (mutation.mutateAsync(payload) || fallbackPromise);
    void (enabled ? mutation.mutateAsync(payload) : fallbackPromise);
    void (enabled ? fallbackPromise : mutation.mutateAsync(payload));
    void (recordAttempt(), mutation.mutateAsync(payload));
  };

  return <button onClick={handleClick}>Save</button>;
};
