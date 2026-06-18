export const myVitePlugin = () => ({
  name: "my-plugin",
  transform(code: string) {
    return code;
  },
});
