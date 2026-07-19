import { useMutation } from "@tanstack/react-query";

export const SaveAllButton = ({ drafts }: { drafts: Draft[] }) => {
  const mutation = useMutation({ mutationFn: saveDraft });

  const handleClick = () => {
    void Promise.all(drafts.map((draft) => mutation.mutateAsync(draft)));
  };

  return <button onClick={handleClick}>Save all</button>;
};
