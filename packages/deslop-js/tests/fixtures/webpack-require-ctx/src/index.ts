const components = require.context("./components", true, /\.tsx$/);
const pages = require.context("./pages", false);
export { components, pages };
