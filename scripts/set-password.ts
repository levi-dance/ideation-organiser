/**
 * One-off: set (or create) the app user's password, since the Supabase
 * dashboard can't set passwords directly and the user was originally created
 * by magic link. Prompts on stdin so the password never lands in shell
 * history. Run: npm run set-password
 */
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
    process.exit(1);
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = (await rl.question("Email: ")).trim();
  const password = await rl.question("New password (min 6 chars): ");
  rl.close();
  if (!email || password.length < 6) {
    console.error("Email required and password must be at least 6 characters.");
    process.exit(1);
  }

  const { data, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
    if (error) throw error;
    console.log(`Password updated for ${email}.`);
  } else {
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    console.log(`User ${email} created with password.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
