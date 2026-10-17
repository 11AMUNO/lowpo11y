"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { formatBytes } from "@/lib/format";
import type { LibraryTexture } from "@/lib/workshop/library";

export interface PickedTexture {
  file: File;
  origin: { asset: string; url: string; licence: string | null };
}

/** Search the published textures and add one as a Workshop input. */
export function LibraryPicker({ onPick, className }: { onPick: (p: PickedTexture) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ q: string; items: LibraryTexture[] | null; error: string | null }>({ q: "\u0000", items: null, error: null });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/workshop/library?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!r.ok) throw new Error();
        setState({ q, items: ((await r.json()) as { items: LibraryTexture[] }).items, error: null });
      } catch {
        if (!ctrl.signal.aborted) setState({ q, items: null, error: "Couldn't load the library. Check your connection and try again." });
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, query]);

  async function add(t: LibraryTexture) {
    setBusy(t.fileId);
    try {
      const r = await fetch(`/api/download/${t.fileId}`);
      if (!r.ok) throw new Error(r.status === 403 ? "This texture's licence doesn't allow downloads." : "The file couldn't be downloaded.");
      const blob = await r.blob();
      onPick({ file: new File([blob], t.filename, { type: blob.type || "image/png" }), origin: { asset: t.slug, url: `/textures/${t.slug}`, licence: t.licence } });
      toast.ok(`Added ${t.title}`, t.attribution ? "Its licence asks for credit; the manifest records where it came from." : undefined);
    } catch (e) {
      toast.error("Couldn't add the texture", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  const loading = state.q !== query.trim() && !state.error;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={className} title="Pick a published texture from the LOWPO11Y library">
          + Library
        </button>
      </DialogTrigger>
      <DialogContent title="Add from the library" description="Published textures whose licence allows downloading. The manifest records each one's source and licence." className="max-w-2xl">
        <div className="flex flex-col gap-3 p-4">
          <Input aria-label="Search textures" placeholder="brick, metal, wood…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          {state.error ? (
            <p role="alert" className="text-[13px] text-bright">
              ! {state.error}
            </p>
          ) : state.items === null || loading ? (
            <p className="font-ocr text-xs text-muted">LOADING…</p>
          ) : state.items.length ? (
            <ul aria-label="Textures" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {state.items.map((t) => (
                <li key={t.fileId} className="flex flex-col border border-rule-strong bg-sunken">
                  <div className="aspect-square bg-checker">{t.thumbnail ? <img src={t.thumbnail} alt="" className="h-full w-full object-contain [image-rendering:pixelated]" loading="lazy" /> : null}</div>
                  <div className="flex flex-1 flex-col gap-1 p-2">
                    <p className="line-clamp-2 text-[12.5px] leading-snug text-fg">{t.title}</p>
                    <p className="font-ocr text-[11px] text-muted">
                      {t.width && t.height ? `${t.width}×${t.height}` : formatBytes(t.sizeBytes)}
                      {t.licence ? ` // ${t.licence}` : ""}
                    </p>
                    <Button size="sm" className="mt-auto" disabled={busy !== null} onClick={() => void add(t)}>
                      {busy === t.fileId ? "Adding…" : <>Add<span className="sr-only"> {t.title}</span></>}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">{query.trim() ? "No textures match." : "No published textures yet."}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
