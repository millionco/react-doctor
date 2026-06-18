module.exports = {
  plugins: [
    [
      "module-resolver",
      {
        root: ["./src"],
        alias: {
          "@components": "./src/components",
        },
      },
    ],
  ],
};
