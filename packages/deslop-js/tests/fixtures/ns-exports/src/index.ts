import { BusinessHelper } from "./helpers";

async function main() {
  await BusinessHelper.inviteSupplier();
  await BusinessHelper.toggleSuspension("acme");
  console.log(BusinessHelper.API_URL);
}

main();
