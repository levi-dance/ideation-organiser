/**
 * Walks the ClickUp workspace (teams → spaces → folders → lists) so real List
 * IDs can be picked from a menu instead of guessed or hand-copied.
 *
 * Read-only: every call underneath is a GET (see the permission scope note in
 * client.ts). Shared by the Settings page and `npm run clickup:discover`.
 */
import {
  getFolderlessLists,
  getFolders,
  getSpaces,
  getTeams,
  type ClickUpList,
} from "@/lib/clickup/client";

export type DiscoveredList = {
  listId: string;
  name: string;
  /** Where it sits, e.g. "Acme Workspace / Marketing / Campaigns". */
  path: string;
  /** Ordered statuses; the first is where new tasks would land. */
  statuses: string[];
};

function toDiscovered(list: ClickUpList, path: string): DiscoveredList {
  return {
    listId: String(list.id),
    name: list.name,
    path,
    statuses: [...(list.statuses ?? [])]
      .sort((a, b) => a.orderindex - b.orderindex)
      .map((s) => s.status),
  };
}

/** Every list the token can see, flattened, in workspace order. */
export async function discoverLists(): Promise<DiscoveredList[]> {
  const found: DiscoveredList[] = [];
  for (const team of await getTeams()) {
    for (const space of await getSpaces(team.id)) {
      const spacePath = `${team.name} / ${space.name}`;
      const [folders, folderless] = await Promise.all([
        getFolders(space.id),
        getFolderlessLists(space.id),
      ]);
      for (const folder of folders) {
        for (const list of folder.lists ?? []) {
          found.push(toDiscovered(list, `${spacePath} / ${folder.name}`));
        }
      }
      for (const list of folderless) {
        found.push(toDiscovered(list, spacePath));
      }
    }
  }
  return found;
}
