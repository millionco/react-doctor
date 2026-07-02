// rule: react-compiler (hooks may not be referenced as normal values)
// weakness: paren-shape
// source: facebook/react#29062 (hook call with explicit generic type argument)
interface Data {}

declare const useQueryClient: () => { invalidateQueries: () => void };
declare const useMutation: <TData>(options: object) => { data?: TData };

export const useHello = () => {
  const queryClient = useQueryClient();
  void queryClient;

  return useMutation<Data>({});
};
