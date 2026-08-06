/**
 * First-run detection for the single account this app has.
 *
 * The Supabase dashboard cannot set a password, so without this the only way
 * to get a login was `npm run set-password` from a clone of the repo. Instead,
 * a deployment with no users at all offers to create the account once, and
 * refuses forever after.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * True only when the project has zero users. Any failure answers false: it is
 * always safer to show a sign-in form that cannot be used than to open account
 * creation on a deployment whose user list we could not read.
 */
export async function needsFirstRunSetup(): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) return false;
    return (data?.users?.length ?? 1) === 0;
  } catch {
    return false;
  }
}
