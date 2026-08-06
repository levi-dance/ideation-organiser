/**
 * Non-secret configuration that lives in Postgres rather than the environment.
 *
 * The timezone decides which calendar week the weekly synthesis covers and how
 * its dates read. It used to be the APP_TIMEZONE env var, which meant the
 * repo's own deployment settings travelled with the code and changing it needed
 * a redeploy. It is read from app_settings now, with APP_TIMEZONE kept as a
 * fallback so an existing install keeps working until the row is saved once.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const DEFAULT_TIMEZONE = "UTC";

/** Whether a string is an IANA zone this runtime actually understands. */
export function isValidTimezone(zone: string): boolean {
  if (!zone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The timezone in force: the saved setting, else the legacy env var, else UTC.
 * Never throws, because a settings problem must not break the weekly synthesis
 * or any page that formats a date.
 */
export async function appTimezone(db?: SupabaseClient): Promise<string> {
  try {
    const client = db ?? createSupabaseAdminClient();
    const { data, error } = await client
      .from("app_settings")
      .select("timezone")
      .limit(1)
      .maybeSingle();
    const saved = typeof data?.timezone === "string" ? data.timezone.trim() : "";
    if (!error && saved && isValidTimezone(saved)) return saved;
  } catch {
    // Table missing on a database that predates it; fall through to the env var.
  }
  const fromEnv = process.env.APP_TIMEZONE?.trim();
  return fromEnv && isValidTimezone(fromEnv) ? fromEnv : DEFAULT_TIMEZONE;
}

/** Where the answer came from, so Settings can explain itself. */
export type TimezoneSource = "database" | "env" | "default";

export async function timezoneWithSource(): Promise<{
  timezone: string;
  source: TimezoneSource;
  /** The table is missing entirely, which is a schema problem worth naming. */
  tableMissing: boolean;
}> {
  let tableMissing = false;
  try {
    const db = createSupabaseAdminClient();
    const { data, error } = await db
      .from("app_settings")
      .select("timezone")
      .limit(1)
      .maybeSingle();
    if (error) tableMissing = /does not exist|schema cache|Could not find/i.test(error.message);
    const saved = typeof data?.timezone === "string" ? data.timezone.trim() : "";
    if (!error && saved && isValidTimezone(saved)) {
      return { timezone: saved, source: "database", tableMissing: false };
    }
  } catch {
    tableMissing = true;
  }
  const fromEnv = process.env.APP_TIMEZONE?.trim();
  if (fromEnv && isValidTimezone(fromEnv)) {
    return { timezone: fromEnv, source: "env", tableMissing };
  }
  return { timezone: DEFAULT_TIMEZONE, source: "default", tableMissing };
}

/** Save the timezone. Upserts the single row so a fresh database self-heals. */
export async function saveTimezone(timezone: string): Promise<void> {
  if (!isValidTimezone(timezone)) {
    throw new Error(`"${timezone}" is not a timezone name this server recognises.`);
  }
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("app_settings")
    .upsert(
      { id: true, timezone: timezone.trim(), updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) throw new Error(error.message);
}
