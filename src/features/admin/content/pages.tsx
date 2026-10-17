import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "@/lib/zod";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead } from "@/components/ui/table";
import { StatusBadge } from "@/features/admin/status-badge";
import { contextFor, requireStaffPage } from "@/lib/auth/server";
import { cn } from "@/lib/cn";
import { adminEditPath, KIND_LABEL, publicPath } from "@/lib/content/paths";
import { getContent, hasStatus, listContent, type ContentKind, type ContentRow } from "@/lib/content/repository";
import { engineLabel, resourceCategoryLabel } from "@/lib/content/schemas";
import { withDb } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate, pluralise } from "@/lib/format";
import { ContentEditor, type Option } from "./content-editor";
import { toFormValues } from "./fields";
import { NewContentForm } from "./new-content-form";

const STATUSES = ["draft", "review", "published", "archived"] as const;
const listParams = z.object({ q: z.string().trim().max(100).optional().catch(undefined), status: z.enum(STATUSES).optional().catch(undefined) });

const EMPTY_COPY: Record<ContentKind, string> = {
  shader: "Add a shader or script you've tested. It's published with its code, setup steps, limitations and a download bundle.",
  starter: "Add a starter project, then upload the ZIP you opened and tested in the engine.",
  creator: "Add a YouTube channel or creator worth learning from, in your own words. Approve them before publishing their videos.",
  tutorial: "Add a video you've watched and recommend, with a short summary of what people will learn.",
  resource: "Add a free tool, library or reference you've checked, with a note on its licence.",
};

function detail(kind: ContentKind, r: ContentRow): string {
  switch (kind) {
    case "shader":
    case "starter":
      return [engineLabel(r.engine), r.tested_at ? `tested ${formatDate(r.tested_at)}` : "not tested"].join(" // ");
    case "creator":
      return (r.categories as string[]).join(", ") || "No topics";
    case "tutorial":
      return [r.creator_name ?? "No creator", r.topic].filter(Boolean).join(" // ");
    case "resource":
      return resourceCategoryLabel(r.category);
  }
}

function LearnTabs({ active }: { active: "tutorial" | "creator" }) {
  return (
    <nav aria-label="Learn" className="mt-5 flex gap-1.5">
      {(["tutorial", "creator"] as const).map((k) => (
        <Link
          key={k}
          href={KIND_LABEL[k].admin}
          aria-current={active === k ? "page" : undefined}
          className={cn(buttonClasses("secondary", "sm"), active === k && "border-bright text-bright [text-shadow:var(--crt-glow)]")}
        >
          {KIND_LABEL[k].many}
        </Link>
      ))}
    </nav>
  );
}

export async function ContentListPage({ kind, searchParams }: { kind: ContentKind; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const base = KIND_LABEL[kind].admin;
  const user = await requireStaffPage(base);
  const raw = await searchParams;
  const p = listParams.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const rows = await withDb(contextFor(user), (q) => listContent(q, kind, { search: p.q, status: p.status }));
  const label = KIND_LABEL[kind];
  const qs = (status?: string) => {
    const s = new URLSearchParams();
    if (status) s.set("status", status);
    if (p.q) s.set("q", p.q);
    const out = s.toString();
    return out ? `?${out}` : "";
  };

  return (
    <div className="mx-auto max-w-[105rem]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-display">{kind === "tutorial" || kind === "creator" ? "Learn" : label.many}</h1>
          <p className="mt-2 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">&gt; {pluralise(rows.length, label.one.toLowerCase())}</p>
        </div>
        <Link href={`${base}/new`} className={buttonClasses("primary", "md")}>
          [ New {label.one.toLowerCase()} ]
        </Link>
      </div>
      {kind === "tutorial" || kind === "creator" ? <LearnTabs active={kind} /> : null}

      {hasStatus(kind) ? (
        <nav aria-label="Filter by status" className="mt-4 flex flex-wrap gap-1.5">
          {[undefined, ...STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={`${base}${qs(s)}`}
              aria-current={p.status === s ? "page" : undefined}
              className={cn(buttonClasses("secondary", "sm"), p.status === s && "border-bright text-bright [text-shadow:var(--crt-glow)]")}
            >
              {s === undefined ? "All" : s === "review" ? "In review" : s[0]!.toUpperCase() + s.slice(1)}
            </Link>
          ))}
        </nav>
      ) : null}

      <form method="get" className="mt-3 flex flex-wrap gap-2" role="search">
        {p.status ? <input type="hidden" name="status" value={p.status} /> : null}
        <label htmlFor="content-q" className="sr-only">
          Search by {kind === "creator" ? "name" : "title"} or slug
        </label>
        <input
          id="content-q"
          name="q"
          type="search"
          defaultValue={p.q ?? ""}
          placeholder={`${kind === "creator" ? "name" : "title"} or slug…`}
          className="h-8 min-w-60 flex-1 border border-edge-strong bg-sunken px-2.5 text-[13px] text-bright outline-none placeholder:text-muted focus-visible:border-bright"
        />
        <button type="submit" className={buttonClasses("secondary", "md")}>
          Search
        </button>
      </form>

      <div className="mt-4">
        {rows.length ? (
          <Table>
            <THead>
              <tr>
                <Th>{kind === "creator" ? "Name" : "Title"}</Th>
                <Th>{kind === "creator" ? "Approval" : "Status"}</Th>
                <Th>{kind === "creator" ? "Topics" : kind === "resource" ? "Category" : kind === "tutorial" ? "Creator" : "Engine"}</Th>
                <Th>Reviewed</Th>
                <Th>Updated</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={adminEditPath(kind, r.id)} className="text-fg hover:text-bright hover:underline">
                      {r.title ?? r.name}
                    </Link>
                    <span className="block font-ocr text-[11px] text-muted">
                      {r.slug}
                      {r.featured ? " // featured" : ""}
                    </span>
                  </Td>
                  <Td>{kind === "creator" ? <Badge tone={r.approved ? "bright" : "neutral"}>{r.approved ? "Approved" : "Not approved"}</Badge> : <StatusBadge status={r.status} />}</Td>
                  <Td className="text-xs text-muted">{detail(kind, r)}</Td>
                  <Td className="font-ocr text-xs text-muted">{r.last_reviewed_at ? formatDate(r.last_reviewed_at) : r.tested_at ? formatDate(r.tested_at) : "Never"}</Td>
                  <Td className="font-ocr text-xs text-muted">{formatDate(r.updated_at)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title={p.q || p.status ? `No ${label.many.toLowerCase()} match` : `No ${label.many.toLowerCase()} yet`}
            action={
              <Link href={`${base}/new`} className={buttonClasses("secondary", "md")}>
                Add a {label.one.toLowerCase()}
              </Link>
            }
          >
            <p>{EMPTY_COPY[kind]}</p>
          </EmptyState>
        )}
      </div>
    </div>
  );
}

export async function NewContentPage({ kind }: { kind: ContentKind }) {
  const base = KIND_LABEL[kind].admin;
  await requireStaffPage(`${base}/new`);
  return (
    <div className="mx-auto max-w-[105rem]">
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: KIND_LABEL[kind].many, href: base }, { label: "New" }]} />
      <h1 className="type-display mt-4 mb-6">New {KIND_LABEL[kind].one.toLowerCase()}</h1>
      <NewContentForm kind={kind} />
    </div>
  );
}

export async function EditContentPage({ kind, params }: { kind: ContentKind; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = KIND_LABEL[kind].admin;
  const user = await requireStaffPage(`${base}/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withDb(contextFor(user), async (q) => {
    const row = await getContent(q, kind, id);
    if (!row) return null;
    const licences =
      kind === "shader" || kind === "starter"
        ? (await q.query<{ id: string; human_label: string; code: string }>("select id, human_label, code from licences order by sort_order")).map((l) => ({ id: l.id, label: l.human_label, ok: l.code !== "unknown" }))
        : [];
    const creators =
      kind === "tutorial" ? (await q.query<{ id: string; name: string; approved: boolean }>("select id, name, approved from tutorial_creators order by lower(name)")).map((c) => ({ id: c.id, label: c.name, ok: c.approved })) : [];
    return { row, licences: licences as Option[], creators: creators as Option[] };
  });
  if (!data) notFound();
  const { row } = data;
  const live = kind === "creator" ? row.approved : row.status === "published";
  const title = String(row.title ?? row.name);

  return (
    <div className="mx-auto max-w-[105rem]">
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: KIND_LABEL[kind].many, href: base }, { label: title }]} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="type-display">{title}</h1>
        {kind === "creator" ? <Badge tone={row.approved ? "bright" : "neutral"}>{row.approved ? "Approved" : "Not approved"}</Badge> : <StatusBadge status={row.status} />}
      </div>
      <p className="mt-2 mb-6 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">
        &gt; {row.slug} // updated {formatDate(row.updated_at)}
        {row.published_at ? ` // published ${formatDate(row.published_at)}` : ""}
      </p>
      <ContentEditor
        kind={kind}
        id={row.id}
        initial={toFormValues(kind, row)}
        status={hasStatus(kind) ? row.status : null}
        approved={kind === "creator" ? row.approved : undefined}
        isAdmin={user.role === "admin"}
        licences={data.licences}
        creators={data.creators}
        publicPath={live ? publicPath(kind, row.slug) : null}
        file={kind === "starter" && row.file_key ? { name: row.file_name, sizeBytes: Number(row.file_size_bytes), sha256: row.file_sha256 } : null}
        hasPublicFile={!!row.file_public_key}
        maxBytes={env().MAX_UPLOAD_BYTES}
      />
    </div>
  );
}
