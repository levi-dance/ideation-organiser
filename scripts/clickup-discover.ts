/**
 * Read-only discovery: print every list the ClickUp token can see, with its id
 * and statuses. The Settings page does this in-app with a clickable picker;
 * this script stays for debugging a token or checking what the API returns.
 * Run: npm run clickup:discover
 */
import { discoverLists } from "../lib/clickup/discover";

async function main() {
  if (!process.env.CLICKUP_API_TOKEN) {
    console.error("CLICKUP_API_TOKEN is not set in .env.local");
    process.exit(1);
  }

  const lists = await discoverLists();
  if (!lists.length) {
    console.log("No lists found. Make sure the API token can see your workspace.");
    return;
  }

  let lastPath = "";
  for (const list of lists) {
    if (list.path !== lastPath) {
      console.log(`\n${list.path}`);
      lastPath = list.path;
    }
    console.log(`  ${list.name}  (id: ${list.listId})`);
    if (list.statuses.length) console.log(`    statuses: ${list.statuses.join(" → ")}`);
  }

  console.log(
    "\n─────────────────────────────────────────────────────────────────────\n" +
      "To use these, open the app's Settings page: it lists the same thing with\n" +
      "an Add button per list, and saves straight to the database - no env var\n" +
      "and no redeploy. Each list needs a description, which is the routing\n" +
      "guidance the classifier reads to pick a list."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
