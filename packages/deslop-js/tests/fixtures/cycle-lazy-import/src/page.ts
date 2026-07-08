export const pageTitle = "page";

export const loadRoutes = async () => {
  const routesModule = await import("./routes");
  return routesModule.renderRoutes();
};
