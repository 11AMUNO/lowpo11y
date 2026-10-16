"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { ChecklistRow, EditorAsset } from "./types";
import { useMutation } from "./use-mutation";

export function PublishPanel({ asset, checklist, isAdmin }: { asset: EditorAsset; checklist: ChecklistRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const { busy, run } = useMutation();
  const blocking = checklist.filter((c) => c.blocking && !c.ok);
  const published = asset.status === "published";

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Publishing checklist">
        {checklist.map((c) => (
          <li key={c.id} className="flex items-baseline gap-2 border-b border-dashed border-rule-strong py-1.5 text-[13px] last:border-0">
            <span aria-hidden className={cn("font-ocr text-xs", c.ok ? "glow" : "text-muted")}>
              {c.ok ? "[✓]" : c.blocking ? "[!]" : "[ ]"}
            </span>
            <span className={c.ok ? "text-fg" : c.blocking ? "text-bright" : "text-muted"}>
              {c.label}
              <span className="sr-only">{c.ok ? " — done" : c.blocking ? " — required" : " — recommended"}</span>
            </span>
          </li>
        ))}
      </ul>

      {isAdmin ? (
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={busy !== null || blocking.length > 0}
            onClick={() => run("publish", () => api(`/api/admin/assets/${asset.id}/publish`, { body: {} }), published ? "Republished; the ZIP was rebuilt" : "Published")}
          >
            {busy === "publish" ? "Publishing…" : published ? "Republish" : "Publish"}
          </Button>
          {blocking.length ? <p className="text-xs text-muted">Finish the items marked [!] to publish.</p> : null}
          {published ? (
            <p className="text-xs leading-relaxed text-muted">Republish after changing files or the licence so the downloadable ZIP matches the page.</p>
          ) : null}
          {published ? (
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm("Take this asset offline? Its public files stop downloading immediately.")) {
                  void run("unpublish", () => api(`/api/admin/assets/${asset.id}/publish`, { method: "DELETE", body: { status: "draft" } }), "Unpublished; back to draft");
                }
              }}
            >
              Unpublish
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {asset.status === "draft" ? (
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() => run("review", () => api(`/api/admin/assets/${asset.id}`, { method: "PATCH", body: { status: "review" } }), "Sent for review")}
            >
              Submit for review
            </Button>
          ) : asset.status === "review" ? (
            <Button disabled={busy !== null} onClick={() => run("draft", () => api(`/api/admin/assets/${asset.id}`, { method: "PATCH", body: { status: "draft" } }), "Back to draft")}>
              Move back to draft
            </Button>
          ) : null}
          <p className="text-xs leading-relaxed text-muted">An admin publishes once the checklist is complete. Published assets can only be edited by admins.</p>
        </div>
      )}

      {asset.publicPath ? (
        <Link href={asset.publicPath} className={buttonClasses("secondary", "md", "w-full")} target="_blank">
          View public page
        </Link>
      ) : null}

      {isAdmin ? (
        <button
          type="button"
          disabled={busy !== null}
          className="mt-2 cursor-pointer self-start font-ocr text-[11px] tracking-[0.08em] text-muted uppercase underline-offset-4 hover:text-bright hover:underline disabled:opacity-40"
          onClick={async () => {
            if (!window.confirm(`Delete “${asset.title}”? It is unpublished and hidden from the admin. Stored files are kept so it can be recovered.`)) return;
            const ok = await run("delete", () => api(`/api/admin/assets/${asset.id}`, { method: "DELETE" }), "Asset deleted");
            if (ok) router.push("/admin/assets");
          }}
        >
          Delete asset
        </button>
      ) : null}
    </div>
  );
}
