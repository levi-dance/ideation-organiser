import { Check, CircleDashed, RotateCcw, Signpost, TriangleAlert, X } from "lucide-react";
import type { Entry } from "@/lib/types";

const STATUS: Record<Entry["status"], { Icon: typeof Check; label: string; color?: string }> = {
  pending: { Icon: CircleDashed, label: "pending" },
  classifying: { Icon: CircleDashed, label: "classifying" },
  filed: { Icon: Check, label: "filed", color: "var(--color-ngreen-700)" },
  partial_error: { Icon: TriangleAlert, label: "partial", color: "var(--color-nyellow-700)" },
  error: { Icon: X, label: "error", color: "var(--color-nred-700)" },
  retracted: { Icon: RotateCcw, label: "undone" },
  needs_routing: { Icon: Signpost, label: "needs routing", color: "var(--color-nyellow-700)" },
};

export default function StatusBadge({ status }: { status: Entry["status"] }) {
  const { Icon, label, color } = STATUS[status];
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{ color: color ?? "var(--color-ink-muted)" }}
    >
      <Icon size={12} strokeWidth={2.5} />
      {label}
    </span>
  );
}
