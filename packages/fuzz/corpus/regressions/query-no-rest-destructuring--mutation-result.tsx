// rule: query-no-rest-destructuring
// weakness: library-idiom
// source: deep audit of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const SaveButton = () => {
  const { mutate, ...mutationState } = useMutation({ mutationFn: save });
  return (
    <button type="button" onClick={() => mutate()}>
      {mutationState.status}
    </button>
  );
};
