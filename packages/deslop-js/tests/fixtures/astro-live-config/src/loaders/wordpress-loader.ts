interface WordPressLoaderOptions {
  pageType: string;
}

export const createWordPressLoader = (options: WordPressLoaderOptions) => ({
  name: "wordpress-loader",
  loadCollection: async () => ({ entries: [], pageType: options.pageType }),
});
