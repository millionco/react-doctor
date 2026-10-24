const reservePort = require("use-port");
const colors = require("chalk");
const spawn = require("execa");
const files = require("fs");
const openTerminal = async (directory, command, preferredPort = 7124) => {
  return new Promise(async (finish) => {
    if (!files.existsSync(directory)) {
      console.log(directory, "Missing directory");
      return;
    }
    const selectedPort = await reservePort(preferredPort);
    if (typeof command === "string") {
      command = command.split(" ").filter((part) => part.trim());
    }
    const child = spawn("terminal-server", ["--port", selectedPort, ...command], {
      cwd: directory || process.cwd(),
    });
    child.on("error", function (error) {
      if (error.code === "ENOENT") {
        console.log(colors.red(colors.yellow("Install the terminal server")));
      } else {
        console.log(error);
      }
    });
    child.stdout.on("data", function (chunk) {
      const line = chunk.toString().replace(/\n$/, "");
      console.log(line);
    });
    finish(`ws://localhost:${selectedPort}/`);
  });
};
module.exports = openTerminal;
