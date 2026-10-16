import type { AuditEntry } from "@/lib/assets/admin";
import { cn } from "@/lib/cn";

const ACTION_LABEL: Record<string, string> = {
  "asset.create": "Created",
  "asset.update": "Edited details",
  "asset.attest": "Confirmed rights",
  "asset.unattest": "Withdrew rights confirmation",
  "asset.derive": "Generated previews",
  "asset.publish": "Published",
  "asset.unpublish": "Unpublished",
  "asset.delete": "Deleted",
  "asset.file.add": "Added a file",
  "asset.file.duplicate": "Re-uploaded an existing file",
  "asset.file.update": "Changed a file",
  "asset.file.delete": "Deleted a file",
  "upload.start": "Started an upload",
  "collection.create": "Created collection",
  "collection.update": "Edited collection",
  "collection.publish": "Published collection",
  "collection.unpublish": "Unpublished collection",
  "collection.delete": "Deleted collection",
  "message.status": "Updated a message",
  "import.run": "Ran a bulk import",
  "auth.login": "Signed in",
  "auth.setup": "Created the first admin",
};

const when = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));

function summary(details: Record<string, unknown>) {
  const pick = ["filename", "title", "status", "fields", "created", "warnings"].filter((k) => details[k] !== undefined && details[k] !== "");
  return pick.map((k) => `${k}: ${String(details[k])}`).join(" // ");
}

export function AuditList({ entries, compact }: { entries: AuditEntry[]; compact?: boolean }) {
  if (!entries.length) return <p className="text-xs text-muted">No recorded changes yet.</p>;
  return (
    <ol className="flex flex-col">
      {entries.map((e) => (
        <li key={e.id} className={cn("border-b border-dashed border-rule-strong last:border-0", compact ? "py-1.5" : "py-2")}>
          <p className="text-[13px] text-fg">
            {ACTION_LABEL[e.action] ?? e.action}
            {!compact ? <span className="ml-2 font-ocr text-[11px] text-muted">{e.target_type}</span> : null}
          </p>
          <p className="font-ocr text-[11px] tracking-[0.04em] text-muted">
            {when(e.created_at)} // {e.actor_name ?? "system"}
            {summary(e.details) ? ` // ${summary(e.details)}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
