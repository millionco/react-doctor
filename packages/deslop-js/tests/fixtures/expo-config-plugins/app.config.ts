const internalToolingConfig = {
  plugins: ["./plugins/false-positive-target.ts"],
};

const expoAppConfig = () => ({
  plugins: [
    `./plugins/template-literal-plugin.ts`,
    ["./plugins/directory-index-plugin", { enabled: true }],
    "./plugins/*.ts",
    "/plugins/false-positive-target.ts",
    ["./plugins/false-positive-placeholder.ts".replace("placeholder", "target"), { enabled: true }],
    "expo-camera",
  ],
  extra: internalToolingConfig,
});

export default expoAppConfig;
