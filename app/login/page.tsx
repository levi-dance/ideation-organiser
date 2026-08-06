import LoginForm from "@/components/auth/LoginForm";
import { needsFirstRunSetup } from "@/lib/auth/setup";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  return <LoginForm firstRun={await needsFirstRunSetup()} />;
}
