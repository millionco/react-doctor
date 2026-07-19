// rule: query-no-mutation-in-effect-as-read
// weakness: name-heuristic
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const BookCheckout = ({ bookId }: { bookId: string }) => {
  const { mutate: checkOutBook, data } = useMutation({ mutationFn: reserveBook });
  useEffect(() => {
    checkOutBook(bookId);
  }, [bookId, checkOutBook]);
  return <output>{data?.receiptId}</output>;
};
