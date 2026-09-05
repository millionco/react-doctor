// verdict: pass
// rule: query-mutation-missing-invalidation
// weakness: name-heuristic
// source: GitHub issue #1759

import { useMutation } from "@tanstack/react-query";

declare const sendMagicLink: (email: string) => Promise<void>;

export const useSendMagicLink = () =>
  useMutation({
    mutationFn: sendMagicLink,
  });
