import * as readline from "node:readline";

const input = readline.createInterface({ input: process.stdin });
for await (const line of input) {
  const request = JSON.parse(line);
  if (request.args.includes("--crash")) process.abort();
  if (request.args.includes("--hang")) continue;
  const outputByteCountArgument = request.args.find((argument) =>
    argument.startsWith("--output-bytes="),
  );
  if (outputByteCountArgument) {
    const outputByteCount = Number(outputByteCountArgument.split("=")[1]);
    process.stdout.write("x".repeat(outputByteCount));
  }
  process.stdout.write(
    `${JSON.stringify({ diagnostics: [], args: request.args })}${request.responseMarker}\u0001\n`,
  );
}
