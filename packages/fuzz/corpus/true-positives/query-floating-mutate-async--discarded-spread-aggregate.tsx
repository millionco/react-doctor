import { useMutation } from "@tanstack/react-query";

export const BulkActions = ({ itemIds }: { itemIds: string[] }) => {
  const mutation = useMutation({ mutationFn: updateItem });

  const updateAll = () => {
    Promise.all([Promise.resolve(), ...itemIds.map((itemId) => mutation.mutateAsync({ itemId }))]);
  };

  return <button onClick={updateAll}>Update all</button>;
};
