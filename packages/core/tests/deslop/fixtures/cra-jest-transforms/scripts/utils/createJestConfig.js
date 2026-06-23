const path = require("path");

module.exports = (resolve) => ({
  transform: {
    "^.+\\.(js|jsx)$": resolve("config/jest/babelTransform.js"),
    "^.+\\.css$": resolve("config/jest/cssTransform.js"),
    "^(?!.*\\.(css|json)$)": resolve("config/jest/fileTransform.js"),
  },
});
