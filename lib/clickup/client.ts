/**
 * ClickUp REST client for the Work pathway.
 *
 * PERMISSION SCOPE — deliberate hard limit while trust is being built.
 * This module is the ONLY place that talks to the ClickUp API, and it exposes
 * exactly three capabilities:
 *   1. Read lists and their open tasks (to route and to match append targets).
 *   2. Create a new task (landing in the list's first/dump status).
 *   3. Append to an existing task's description (never replace).
 * Nothing here may change Status, Priority, Type, Platform, or any other
 * field on an existing task, delete or archive anything, or move a task
 * between lists. Do not add such capabilities without the owner's explicit OK.
 */

const API_BASE = "https://api.clickup.com/api/v2";

export type ClickUpStatus = { status: string; orderindex: number };

export type ClickUpList = {
  id: string;
  name: string;
  statuses: ClickUpStatus[];
};

export type ClickUpTask = {
  id: string;
  name: string;
  url: string;
  status: string;
  markdownDescription: string;
};

function token(): string {
  const t = process.env.CLICKUP_API_TOKEN;
  if (!t) throw new Error("CLICKUP_API_TOKEN is not set");
  return t;
}

async function api<T>(
  path: string,
  init?: { method?: "GET" | "POST" | "PUT"; body?: unknown }
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: token(),
      "Content-Type": "application/json",
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`ClickUp ${init?.method ?? "GET"} ${path} → ${res.status} ${text}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export function clickupTaskUrl(taskId: string): string {
  return `https://app.clickup.com/t/${taskId}`;
}

/** List metadata including its ordered statuses (lowest orderindex = dump). */
export async function getList(listId: string): Promise<ClickUpList> {
  const raw = await api<{ id: string; name: string; statuses: ClickUpStatus[] }>(
    `/list/${listId}`
  );
  return { id: raw.id, name: raw.name, statuses: raw.statuses ?? [] };
}

/** The list's first status by orderindex — where new tasks are dumped. */
export function dumpStatus(list: ClickUpList): string | null {
  if (!list.statuses.length) return null;
  return [...list.statuses].sort((a, b) => a.orderindex - b.orderindex)[0].status;
}

type RawTask = {
  id: string;
  name: string;
  url: string;
  status: { status: string };
  markdown_description?: string;
  description?: string;
};

/** Open (non-closed) tasks in a list, for routing and append-matching. */
export async function getListTasks(listId: string): Promise<ClickUpTask[]> {
  const tasks: ClickUpTask[] = [];
  for (let page = 0; ; page++) {
    const res = await api<{ tasks: RawTask[]; last_page?: boolean }>(
      `/list/${listId}/task?page=${page}&include_closed=false&subtasks=false`
    );
    for (const t of res.tasks) {
      tasks.push({
        id: t.id,
        name: t.name,
        url: t.url,
        status: t.status?.status ?? "",
        markdownDescription: t.markdown_description ?? t.description ?? "",
      });
    }
    if (res.last_page !== false || !res.tasks.length) break;
  }
  return tasks;
}

/**
 * Create a task in the list's dump status. Only name, description, and status
 * are set — no priority, assignees, tags, or custom fields; triage is the owner's.
 */
export async function createTask(params: {
  listId: string;
  name: string;
  markdown: string;
  status: string | null;
}): Promise<{ taskId: string; url: string }> {
  const res = await api<{ id: string; url: string }>(`/list/${params.listId}/task`, {
    method: "POST",
    body: {
      name: params.name.slice(0, 512),
      markdown_content: params.markdown,
      ...(params.status ? { status: params.status } : {}),
    },
  });
  return { taskId: res.id, url: res.url };
}

/**
 * Append markdown to a task's description, preserving what's there.
 * ClickUp's update endpoint replaces the description, so read-then-write:
 * fetch the current markdown, concatenate, and PUT only the description
 * field back (touching no other task fields).
 */
export async function appendToTaskDescription(
  taskId: string,
  markdown: string
): Promise<{ taskId: string; url: string; taskName: string }> {
  const current = await api<RawTask>(`/task/${taskId}?include_markdown_description=true`);
  const existing = (current.markdown_description ?? current.description ?? "").trimEnd();
  const combined = existing ? `${existing}\n\n---\n\n${markdown}` : markdown;
  await api(`/task/${taskId}`, {
    method: "PUT",
    body: { markdown_content: combined },
  });
  return { taskId, url: current.url ?? clickupTaskUrl(taskId), taskName: current.name };
}
