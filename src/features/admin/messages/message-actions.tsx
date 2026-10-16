"use client";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useMutation } from "../asset-editor/use-mutation";

export function MessageActions({ id, status }: { id: string; status: "new" | "in_progress" | "resolved" }) {
  const { busy, run } = useMutation();
  const set = (s: typeof status, label: string) => run(s, () => api(`/api/admin/messages/${id}`, { method: "PATCH", body: { status: s } }), label);
  return (
    <div className="flex flex-wrap gap-1.5">
      {status !== "in_progress" ? (
        <Button size="sm" disabled={busy !== null} onClick={() => set("in_progress", "Marked in progress")}>
          In progress
        </Button>
      ) : null}
      {status !== "resolved" ? (
        <Button size="sm" disabled={busy !== null} onClick={() => set("resolved", "Marked resolved")}>
          Resolved
        </Button>
      ) : null}
      {status !== "new" ? (
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => set("new", "Reopened")}>
          Reopen
        </Button>
      ) : null}
    </div>
  );
}
