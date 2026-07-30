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

function printList(l: List, indent: string) {
  const statuses = (l.statuses ?? [])
    .sort((a, b) => a.orderindex - b.orderindex)
    .map((s) => s.status)
    .join(" → ");
  console.log(`${indent}list: ${l.name}  (id: ${l.id})`);
  if (statuses) console.log(`${indent}  statuses: ${statuses}`);
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
  console.log(
    "\nFill in .env.local with the lists the Work pathway may file into, e.g.:\n" +
      `  CLICKUP_LISTS=[{"listId":"901234567","name":"Client Content",` +
      `"description":"Content pipeline for this client: ideas, posts, production tasks."}]\n` +
      "The description is routing guidance for the classifier — describe what belongs in the list."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
