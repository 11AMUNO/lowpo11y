"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { api, fieldErrors } from "@/lib/api-client";
import { useMutation } from "../asset-editor/use-mutation";

export interface MemberView {
  id: string;
  title: string;
  slug: string;
  status: string;
  thumbnail: string | null;
  licence: string | null;
}

export interface CollectionView {
  id: string;
  slug: string;
  title: string;
  summary: string;
  descriptionMd: string;
  featured: boolean;
  status: "draft" | "review" | "published" | "archived";
  bundleBuiltAt: string | null;
}

export function CollectionEditor({ collection, members: initial, isAdmin }: { collection: CollectionView; members: MemberView[]; isAdmin: boolean }) {
  const router = useRouter();
  const { busy, run } = useMutation();
  const [members, setMembers] = useState(initial);
  const [featured, setFeatured] = useState(collection.featured);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ q: string; items: MemberView[] }>({ q: "", items: [] });
  const dirtyMembers = members.map((m) => m.id).join() !== initial.map((m) => m.id).join();
  const readOnly = !isAdmin && (collection.status === "published" || collection.status === "archived");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await api<{ items: { id: string; title: string; slug: string; status: string; thumbnail_url: string | null; licence_short: string | null }[] }>(
          `/api/admin/assets/search?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
        );
        setResults({ q, items: r.items.map((i) => ({ id: i.id, title: i.title, slug: i.slug, status: i.status, thumbnail: i.thumbnail_url, licence: i.licence_short })) });
      } catch {
        // Aborted or offline: keep the previous results.
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);
  const shown = query.trim().length >= 2 && results.q === query.trim() ? results.items : [];

  const move = (i: number, d: -1 | 1) =>
    setMembers((list) => {
      const next = [...list];
      const j = i + d;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErrors({});
    await run(
      "save",
      () =>
        api(`/api/admin/collections/${collection.id}`, {
          method: "PATCH",
          body: { title: String(f.get("title")), summary: String(f.get("summary")), descriptionMd: String(f.get("descriptionMd")), featured, assetIds: members.map((m) => m.id) },
        }).catch((err) => {
          setErrors(fieldErrors(err));
          throw err;
        }),
      "Collection saved",
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <fieldset disabled={readOnly} className="contents">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Details">
            <div className="flex flex-col gap-4">
              <Field label="Title" error={errors.title} required>
                <Input name="title" defaultValue={collection.title} maxLength={120} />
              </Field>
              <Field label="Summary" error={errors.summary} hint="One or two sentences for the collection card.">
                <Input name="summary" defaultValue={collection.summary} maxLength={240} />
              </Field>
              <Field label="Description" error={errors.descriptionMd} hint="Markdown.">
                <Textarea name="descriptionMd" defaultValue={collection.descriptionMd} rows={5} />
              </Field>
              <Checkbox label="Featured" description="Shown first on the collections page." checked={featured} onCheckedChange={setFeatured} disabled={readOnly} />
            </div>
          </Panel>
          <Panel title={`Assets (${members.length})`}>
            {members.length ? (
              <ol className="flex flex-col">
                {members.map((m, i) => (
                  <li key={m.id} className="flex items-center gap-3 border-b border-dashed border-rule-strong py-1.5 last:border-0">
                    <span className="w-6 font-ocr text-[11px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                    <span className="size-9 shrink-0 border border-rule-strong bg-sunken">{m.thumbnail ? <img src={m.thumbnail} alt="" className="h-full w-full object-contain" /> : null}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-fg">{m.title}</span>
                      <span className="font-ocr text-[11px] text-muted">
                        {m.status}
                        {m.licence ? ` // ${m.licence}` : ""}
                      </span>
                    </span>
                    {m.status !== "published" ? <Badge tone="outline">Not published</Badge> : null}
                    <IconButton label={`Move ${m.title} up`} icon={<span aria-hidden>▲</span>} size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton label={`Move ${m.title} down`} icon={<span aria-hidden>▼</span>} size="sm" disabled={i === members.length - 1} onClick={() => move(i, 1)} />
                    <IconButton label={`Remove ${m.title}`} icon={<span aria-hidden>×</span>} size="sm" onClick={() => setMembers((l) => l.filter((x) => x.id !== m.id))} />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-muted">No assets yet. Search below to add some.</p>
            )}
            <div className="mt-4 border-t border-dashed border-rule-strong pt-3">
              <Field label="Add assets" hint="Type at least two letters of a title or slug.">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="crate, brick…" />
              </Field>
              {shown.length ? (
                <ul className="mt-2 flex flex-col" aria-label="Matching assets">
                  {shown.map((r) => {
                    const added = members.some((m) => m.id === r.id);
                    return (
                      <li key={r.id} className="flex items-center gap-3 py-1">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                          {r.title} <span className="font-ocr text-[11px] text-muted">// {r.status}</span>
                        </span>
                        <Button size="sm" disabled={added} onClick={() => setMembers((l) => [...l, r])}>
                          {added ? "Added" : "Add"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </Panel>
        </div>
        <aside className="flex flex-col gap-5" aria-label="Save and publish">
          <Panel title="Save">
            <div className="flex flex-col gap-2">
              <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy !== null || readOnly}>
                {busy === "save" ? "Saving…" : "Save collection"}
              </Button>
              {dirtyMembers ? <p className="text-xs text-bright">Unsaved changes to the asset list.</p> : null}
            </div>
          </Panel>
          {isAdmin ? (
            <Panel title="Publish">
              <div className="flex flex-col gap-2">
                <p className="text-xs leading-relaxed text-muted">
                  Every asset must be published, and every licence must allow redistribution in a pack. Publishing builds the ZIP with a NOTICE listing each licence.
                </p>
                <Button
                  variant="primary"
                  disabled={busy !== null || dirtyMembers || !members.length}
                  onClick={() => run("publish", () => api(`/api/admin/collections/${collection.id}/publish`, { body: {} }), collection.status === "published" ? "Pack rebuilt" : "Collection published")}
                >
                  {busy === "publish" ? "Building pack…" : collection.status === "published" ? "Rebuild pack" : "Publish"}
                </Button>
                {collection.status === "published" ? (
                  <>
                    <a href={`/collections/${collection.slug}`} target="_blank" rel="noreferrer" className="text-center text-xs text-bright underline underline-offset-4">
                      View public page
                    </a>
                    <Button
                      variant="danger"
                      disabled={busy !== null}
                      onClick={() => {
                        if (window.confirm("Unpublish this collection? Its pack ZIP stops downloading immediately.")) {
                          void run("unpublish", () => api(`/api/admin/collections/${collection.id}/publish`, { method: "DELETE" }), "Collection unpublished");
                        }
                      }}
                    >
                      Unpublish
                    </Button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="mt-2 cursor-pointer self-start font-ocr text-[11px] tracking-[0.08em] text-muted uppercase hover:text-bright hover:underline"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (!window.confirm(`Delete “${collection.title}”? The assets in it are not affected.`)) return;
                    const ok = await run("delete", () => api(`/api/admin/collections/${collection.id}`, { method: "DELETE" }), "Collection deleted");
                    if (ok) router.push("/admin/collections");
                  }}
                >
                  Delete collection
                </button>
              </div>
            </Panel>
          ) : null}
        </aside>
      </fieldset>
    </form>
  );
}
