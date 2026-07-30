/**
 * Read-only discovery: walk the ClickUp workspace (teams → spaces → folders →
 * lists) and print every list with its id and statuses, so the real List IDs
 * can be confirmed and dropped into the CLICKUP_LISTS env var — never guessed.
 * Run: npm run clickup:discover
 */
const API = "https://api.clickup.com/api/v2";

async function api<T>(path: string): Promise<T> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) {
    console.error("CLICKUP_API_TOKEN is not set in .env.local");
    process.exit(1);
  }
  const res = await fetch(`${API}${path}`, { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

type List = { id: string; name: string; statuses?: { status: string; orderindex: number }[] };

// Every list seen while walking, collected for the copy-paste CLICKUP_LISTS block.
const discovered: { listId: string; name: string; description: string }[] = [];

function printList(l: List, indent: string) {
  const statuses = (l.statuses ?? [])
    .sort((a, b) => a.orderindex - b.orderindex)
    .map((s) => s.status)
    .join(" → ");
  console.log(`${indent}list: ${l.name}  (id: ${l.id})`);
  if (statuses) console.log(`${indent}  statuses: ${statuses}`);
  discovered.push({
    listId: l.id,
    name: l.name,
    description: "TODO: what belongs in this list",
  });
}

async function main() {
  const { teams } = await api<{ teams: { id: string; name: string }[] }>("/team");
  for (const team of teams) {
    console.log(`workspace: ${team.name} (id: ${team.id})`);
    const { spaces } = await api<{ spaces: { id: string; name: string }[] }>(
      `/team/${team.id}/space?archived=false`
    );
    for (const space of spaces) {
      console.log(`  space: ${space.name} (id: ${space.id})`);
      const [{ folders }, { lists: folderless }] = await Promise.all([
        api<{ folders: { id: string; name: string; lists: List[] }[] }>(
          `/space/${space.id}/folder?archived=false`
        ),
        api<{ lists: List[] }>(`/space/${space.id}/list?archived=false`),
      ]);
      for (const folder of folders) {
        console.log(`    folder: ${folder.name} (id: ${folder.id})`);
        for (const list of folder.lists) printList(list, "      ");
      }
      for (const list of folderless) printList(list, "    ");
    }
  }

  if (!discovered.length) {
    console.log("\nNo lists found. Make sure the API token can see your workspace.");
    return;
  }

  console.log(
    "\n─────────────────────────────────────────────────────────────────────\n" +
      "Copy this line into .env.local. Then: delete any lists the Work pathway\n" +
      "should NOT file into, and replace each TODO with a real description —\n" +
      "the description is routing guidance the classifier reads to pick a list,\n" +
      "so it's what makes work routing good.\n"
  );
  console.log(`CLICKUP_LISTS=${JSON.stringify(discovered)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
