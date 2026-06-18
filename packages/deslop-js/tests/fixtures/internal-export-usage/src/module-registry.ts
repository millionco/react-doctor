interface ModuleRegistration {
  module: { token: string };
  token: string;
}

export const registerModule = (registration: ModuleRegistration): void => {
  registration.module.token;
};
