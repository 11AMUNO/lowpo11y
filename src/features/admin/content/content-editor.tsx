"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, type FormEvent } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { api, ApiError, fieldErrors } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { publishChecklist } from "@/lib/content/checklist";
import { KIND_LABEL } from "@/lib/content/paths";
import type { ContentKind } from "@/lib/content/repository";
import { parseYouTubeId } from "@/lib/content/schemas";
import { useMutation } from "../asset-editor/use-mutation";
import { PANELS, toPayload, type FieldDef, type FormValues } from "./fields";
import { ShaderPreview } from "@/features/content/shader-preview/shader-preview";
import { splitStages } from "@/features/content/shader-preview/parse";
import { StarterFilePanel, type StarterFile } from "./starter-file-panel";

export interface Option {
  id: string;
  label: string;
  /** Licences: not the "unknown" placeholder. Creators: approved. */
  ok: boolean;
}

export interface ContentEditorProps {
  kind: ContentKind;
  id: string;
  initial: FormValues;
  status: "draft" | "review" | "published" | "archived" | null;
  approved?: boolean;
  isAdmin: boolean;
  licences: Option[];
  creators: Option[];
  publicPath: string | null;
  file?: StarterFile | null;
  hasPublicFile?: boolean;
  maxBytes: number;
}

type Status = NonNullable<ContentEditorProps["status"]>;

export function ContentEditor(props: ContentEditorProps) {
  const { kind, id, initial, status, approved, isAdmin, licences, creators, publicPath } = props;
  const router = useRouter();
  const { busy, run } = useMutation();
  const [values, setValues] = useState<FormValues>(initial);
  const [base, setBase] = useState<FormValues>(initial);
  const [saving, setSaving] = useState<FormValues | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(values) !== JSON.stringify(base);
  // After a save (or a file upload) the server sends fresh, normalised values;
  // take them unless the form was edited again in the meantime.
  if (JSON.stringify(initial) !== JSON.stringify(base)) {
    setBase(initial);
    setSaving(null);
    if (!dirty || (saving && JSON.stringify(values) === JSON.stringify(saving))) setValues(initial);
  }
  const live = status === "published" || approved === true;
  const readOnly = !isAdmin && (status === "published" || status === "archived" || approved === true);
  const label = KIND_LABEL[kind].one;

  const set = (name: string, v: FormValues[string]) => setValues((s) => ({ ...s, [name]: v }));

  const checklist = useMemo(() => {
    const row: Record<string, unknown> = { ...toPayload(kind, values), file_key: props.file ? "uploaded" : null };
    return publishChecklist(kind, row, {
      licenceKnown: licences.find((l) => l.id === values.licence_id)?.ok ?? false,
      creatorApproved: creators.find((c) => c.id === values.creator_id)?.ok ?? false,
    });
  }, [kind, values, licences, creators, props.file]);
  const ready = checklist.every((c) => c.ok);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setSaving(values);
    await run(
      "save",
      () =>
        api(`/api/admin/content/${kind}/${id}`, { method: "PATCH", body: toPayload(kind, values) }).catch((err) => {
          setErrors(fieldErrors(err));
          throw err;
        }),
      live ? `Saved. The public page shows the change now${kind === "shader" ? "; republish to rebuild the download" : ""}.` : "Saved",
    );
  }

  const setStatus = (to: Status, message: string) => run(to, () => api(`/api/admin/content/${kind}/${id}/status`, { body: { status: to } }), message);
  const setApproved = (to: boolean) => run(to ? "approve" : "unapprove", () => api(`/api/admin/content/creator/${id}/status`, { body: { approved: to } }), to ? "Creator approved" : "Approval removed; their videos are back in draft");

  return (
    <form onSubmit={save} noValidate className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <fieldset disabled={readOnly} className="contents">
          {PANELS[kind].map((panel) => (
            <Fragment key={panel.title}>
              <Panel title={panel.title}>
                <div className="flex flex-col gap-4">
                  {panel.fields.map((f) => (
                    <FieldControl key={f.name} field={f} value={values[f.name]} error={errors[f.name]} onChange={(v) => set(f.name, v)} licences={licences} creators={creators} disabled={readOnly} />
                  ))}
                </div>
              </Panel>
              {panel.title === "Code" && kind === "shader" && values.engine === "threejs" ? <AdminShaderPreview code={String(values.code ?? "")} /> : null}
            </Fragment>
          ))}
        </fieldset>
        {kind === "starter" ? <StarterFilePanel starterId={id} file={props.file ?? null} maxBytes={props.maxBytes} readOnly={readOnly} published={status === "published"} /> : null}
      </div>

      <aside className="flex flex-col gap-5 lg:sticky lg:top-16" aria-label="Save and publish">
        <Panel title="Save">
          <div className="flex flex-col gap-2">
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy !== null || readOnly || !dirty}>
              {busy === "save" ? "Saving…" : `Save ${label.toLowerCase()}`}
            </Button>
            <p className="text-xs text-muted" role="status">
              {readOnly ? "Only admins can edit this now it's live." : dirty ? "You have unsaved changes." : "All changes saved."}
            </p>
          </div>
        </Panel>

        <Panel title={kind === "creator" ? "Approval" : "Publish"}>
          <div className="flex flex-col gap-3">
            <ul aria-label={kind === "creator" ? "Approval checklist" : "Publishing checklist"}>
              {checklist.map((c) => (
                <li key={c.label} className="flex items-baseline gap-2 border-b border-dashed border-rule-strong py-1.5 text-[13px] last:border-0">
                  <span aria-hidden className={cn("font-ocr text-xs", c.ok ? "glow" : "text-muted")}>
                    {c.ok ? "[✓]" : "[!]"}
                  </span>
                  <span className={c.ok ? "text-fg" : "text-bright"}>
                    {c.label}
                    <span className="sr-only">{c.ok ? " — done" : " — required"}</span>
                  </span>
                </li>
              ))}
            </ul>
            {kind === "creator" ? (
              isAdmin ? (
                approved ? (
                  <Button variant="danger" disabled={busy !== null} onClick={() => window.confirm("Remove approval? Their published videos go back to draft.") && void setApproved(false)}>
                    Remove approval
                  </Button>
                ) : (
                  <Button variant="primary" disabled={busy !== null || dirty || !ready} onClick={() => void setApproved(true)}>
                    {busy === "approve" ? "Approving…" : "Approve creator"}
                  </Button>
                )
              ) : (
                <p className="text-xs leading-relaxed text-muted">An admin approves creators once the checklist is complete. Videos can only be published for approved creators.</p>
              )
            ) : (
              <StatusActions kind={kind} status={status ?? "draft"} isAdmin={isAdmin} busy={busy} dirty={dirty} ready={ready} setStatus={setStatus} />
            )}
            {dirty && !readOnly ? <p className="text-xs text-bright">Save your changes before {kind === "creator" ? "approving" : "publishing"}.</p> : null}
          </div>
        </Panel>

        {publicPath ? (
          <Link href={publicPath} className={buttonClasses("secondary", "md", "w-full")} target="_blank">
            View public page
          </Link>
        ) : null}

        {isAdmin ? (
          <button
            type="button"
            disabled={busy !== null}
            className="cursor-pointer self-start font-ocr text-[11px] tracking-[0.08em] text-muted uppercase underline-offset-4 hover:text-bright hover:underline disabled:opacity-40"
            onClick={async () => {
              const warn = kind === "creator" ? " Their videos stay, unpublished and without a creator." : props.hasPublicFile ? " Its download stops working immediately." : "";
              if (!window.confirm(`Delete “${values.title || values.name}”?${warn}`)) return;
              const ok = await run("delete", () => api(`/api/admin/content/${kind}/${id}`, { method: "DELETE" }), `${label} deleted`);
              if (ok) router.push(KIND_LABEL[kind].admin);
            }}
          >
            Delete {label.toLowerCase()}
          </button>
        ) : null}
      </aside>
    </form>
  );
}

function StatusActions({
  kind,
  status,
  isAdmin,
  busy,
  dirty,
  ready,
  setStatus,
}: {
  kind: ContentKind;
  status: Status;
  isAdmin: boolean;
  busy: string | null;
  dirty: boolean;
  ready: boolean;
  setStatus: (to: Status, message: string) => Promise<unknown>;
}) {
  const bundles = kind === "shader" || kind === "starter";
  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-2">
        {status === "draft" ? (
          <Button variant="primary" disabled={busy !== null || dirty} onClick={() => void setStatus("review", "Sent for review")}>
            Submit for review
          </Button>
        ) : status === "review" ? (
          <Button disabled={busy !== null || dirty} onClick={() => void setStatus("draft", "Back to draft")}>
            Move back to draft
          </Button>
        ) : null}
        <p className="text-xs leading-relaxed text-muted">An admin publishes once the checklist is complete. Published entries can only be edited by admins.</p>
      </div>
    );
  }
  const published = status === "published";
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={busy !== null || dirty || !ready}
        onClick={() => void setStatus("published", published ? "Republished; the download was rebuilt" : "Published")}
      >
        {busy === "published" ? "Publishing…" : published && bundles ? "Republish" : published ? "Published" : "Publish"}
      </Button>
      {!ready ? <p className="text-xs text-muted">Finish the items marked [!] to publish.</p> : null}
      {published && bundles ? <p className="text-xs leading-relaxed text-muted">Republish after changing the code, file or licence so the download matches the page.</p> : null}
      {published ? (
        <Button variant="danger" disabled={busy !== null} onClick={() => window.confirm(`Unpublish? It disappears from the site${bundles ? " and its download stops working" : ""} immediately.`) && void setStatus("draft", "Unpublished; back to draft")}>
          Unpublish
        </Button>
      ) : status !== "archived" ? (
        <Button variant="ghost" disabled={busy !== null} onClick={() => void setStatus("archived", "Archived")}>
          Archive
        </Button>
      ) : (
        <Button variant="ghost" disabled={busy !== null} onClick={() => void setStatus("draft", "Back to draft")}>
          Restore to draft
        </Button>
      )}
    </div>
  );
}

function FieldControl({
  field: f,
  value,
  error,
  onChange,
  licences,
  creators,
  disabled,
}: {
  field: FieldDef;
  value: FormValues[string] | undefined;
  error?: string;
  onChange: (v: FormValues[string]) => void;
  licences: Option[];
  creators: Option[];
  disabled: boolean;
}) {
  const str = typeof value === "string" ? value : "";
  switch (f.type) {
    case "checkbox":
      return <Checkbox label={f.label} description={f.description} checked={value === true} onCheckedChange={onChange} disabled={disabled} />;
    case "checklist": {
      const list = Array.isArray(value) ? value : [];
      return (
        <fieldset className="flex flex-col gap-2">
          <legend className="type-label mb-2">{f.label}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {f.options.map((o) => (
              <Checkbox key={o} label={o} checked={list.includes(o)} disabled={disabled} onCheckedChange={(on) => onChange(on ? [...list, o] : list.filter((x) => x !== o))} />
            ))}
          </div>
        </fieldset>
      );
    }
    case "select":
      return (
        <Field label={f.label} hint={f.hint} error={error} required={f.required}>
          <Select value={str} onChange={(e) => onChange(e.target.value)}>
            {f.empty !== undefined || !f.required ? <option value="">{f.empty ?? "Not set"}</option> : null}
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "licence":
    case "creator": {
      const opts = f.type === "licence" ? licences : creators;
      const chosen = opts.find((o) => o.id === str);
      const hint =
        f.type === "licence"
          ? chosen && !chosen.ok
            ? "Unknown licence: this can't be published until the real licence is confirmed."
            : "The licence the download is released under. Confirm you have the right to use it."
          : chosen && !chosen.ok
            ? "This creator isn't approved yet, so the video can't be published."
            : "Who made the video. Add creators under Learn → Creators.";
      return (
        <Field label={f.label} hint={hint} error={error}>
          <Select value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">{f.type === "licence" ? "Choose a licence" : "Choose a creator"}</option>
            {opts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {f.type === "creator" && !o.ok ? " (not approved)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      );
    }
    case "youtube":
      return <YouTubeField label={f.label} value={str} error={error} onChange={(v) => onChange(v)} disabled={disabled} />;
    case "textarea":
    case "markdown":
    case "code":
    case "lines":
      return (
        <Field label={f.label} hint={f.hint} error={error} required={f.required}>
          <Textarea
            value={str}
            onChange={(e) => onChange(e.target.value)}
            rows={"rows" in f ? f.rows : 4}
            maxLength={"max" in f ? f.max : undefined}
            spellCheck={f.type !== "code"}
            className={f.type === "code" ? "font-mono text-[12.5px] leading-snug whitespace-pre" : undefined}
            wrap={f.type === "code" ? "off" : undefined}
          />
        </Field>
      );
    default:
      return (
        <Field label={f.label} hint={f.hint} error={error} required={f.required}>
          <Input
            type={f.type === "url" ? "url" : f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
            value={str}
            onChange={(e) => onChange(e.target.value)}
            maxLength={f.type === "text" ? f.max : undefined}
            min={f.type === "number" ? f.min : undefined}
            max={f.type === "number" ? f.max : undefined}
            placeholder={f.type === "text" || f.type === "url" ? f.placeholder : undefined}
            inputMode={f.type === "number" ? "numeric" : undefined}
          />
        </Field>
      );
  }
}

function YouTubeField({ label, value, error, onChange, disabled }: { label: string; value: string; error?: string; onChange: (v: string) => void; disabled: boolean }) {
  const [check, setCheck] = useState<{ state: "idle" | "busy" | "ok" | "failed"; text?: string }>({ state: "idle" });
  const id = parseYouTubeId(value);
  async function verify() {
    if (!id) return;
    setCheck({ state: "busy" });
    try {
      const r = await api<{ title: string; authorName: string }>(`/api/admin/content/youtube?v=${encodeURIComponent(id)}`);
      setCheck({ state: "ok", text: `Found “${r.title}” by ${r.authorName}. Check the creator above matches.` });
    } catch (e) {
      setCheck({ state: "failed", text: e instanceof ApiError ? e.message : "Couldn't reach YouTube." });
    }
  }
  return (
    <Field
      label={label}
      error={error}
      hint={check.text ?? (value && !id ? "Paste a YouTube link (watch, youtu.be or shorts) or the 11-character video id." : id && id !== value ? `Video id: ${id}` : "Paste the video's link. Videos play from youtube-nocookie.com only after a visitor clicks.")}
    >
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => {
            setCheck({ state: "idle" });
            onChange(e.target.value);
          }}
          onBlur={() => id && id !== value && onChange(id)}
          placeholder="https://www.youtube.com/watch?v=…"
          className="min-w-0 flex-1"
        />
        <Button size="md" disabled={!id || disabled || check.state === "busy"} onClick={() => void verify()}>
          {check.state === "busy" ? "Checking…" : "Check on YouTube"}
        </Button>
      </div>
    </Field>
  );
}

/** Compiles the code as it is in the form, on request, so a three.js shader can be checked before it's published. */
function AdminShaderPreview({ code }: { code: string }) {
  const [run, setRun] = useState<{ code: string; n: number } | null>(null);
  const followsConvention = !!splitStages(code);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!followsConvention} onClick={() => setRun((r) => ({ code, n: (r?.n ?? 0) + 1 }))}>
          {run ? "Recompile preview" : "Compile and preview"}
        </Button>
        <p className="text-xs text-muted">
          {followsConvention
            ? "Runs the code in this form, saved or not, on the same scene visitors see."
            : "For a live preview, split the file with // --- vertex --- and // --- fragment --- lines, each with its own main()."}
        </p>
      </div>
      {run ? <ShaderPreview key={run.n} code={run.code} note="Runs the code as it was when you pressed Compile. Press it again after editing." /> : null}
    </div>
  );
}
