import { useMutation } from "@tanstack/react-query";

export const SaveButton = () => {
  const mutation = useMutation({ mutationFn: saveDraft });
  const save = mutation!.mutateAsync as (draft: Draft) => Promise<unknown>;

  const handleClick = () => {
    (save as (draft: Draft) => Promise<unknown>)(draft);
  };

  return <button onClick={handleClick}>Save</button>;
};
