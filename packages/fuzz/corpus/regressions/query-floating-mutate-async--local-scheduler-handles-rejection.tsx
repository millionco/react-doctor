import { useMutation } from "@tanstack/react-query";

export const SaveButton = () => {
  const setTimeout = (callback: () => Promise<unknown>) => callback().catch(reportError);
  const mutation = useMutation({ mutationFn: saveDraft });
  const save = () => mutation.mutateAsync(draft);

  setTimeout(save);

  return null;
};
