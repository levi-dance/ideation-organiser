/**
 * CLI wrapper for the Notion taxonomy sync.
 * Run: npm run sync
 */
import { runNotionSync } from "../lib/notion/sync";

runNotionSync()
  .then((report) => {
    console.log(`Scanned ${report.scanned} Notion items.`);
    const sections: [string, string[]][] = [
      ["New categories", report.createdCategories],
      ["New destinations", report.createdDestinations],
      ["Renamed", report.renamed],
      ["Reactivated", report.reactivated],
      ["Deactivated", report.deactivated],
    ];
    let changed = false;
    for (const [label, items] of sections) {
      if (items.length) {
        changed = true;
        console.log(`${label}:`);
        for (const item of items) console.log(`  - ${item}`);
      }
    }
    if (!changed) console.log("Already up to date.");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
