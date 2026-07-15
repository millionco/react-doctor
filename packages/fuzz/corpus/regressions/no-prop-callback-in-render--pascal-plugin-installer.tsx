// rule: no-prop-callback-in-render
// weakness: name-heuristic
// source: React Bench fix-react-rdh-igordanchenko-yet__AdG6oV8 / PR #1295
interface PluginProps {
  addModule: (name: string) => void;
}

interface Plugin {
  (props: PluginProps): void;
}

interface PluginConfig {
  modules: string[];
}

const EventsHarnessPlugin = ({ addModule }: PluginProps): void => {
  addModule("test-events");
};

export const withPlugins = (plugins: readonly Plugin[]) => {
  const config: PluginConfig = { modules: [] };
  const addModule = (name: string): void => {
    config.modules.push(name);
  };
  plugins.forEach((plugin) => plugin({ addModule }));
  return config;
};

export const pluginConfig = withPlugins([EventsHarnessPlugin]);
