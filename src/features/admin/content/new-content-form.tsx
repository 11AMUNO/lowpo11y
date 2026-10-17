"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { api, fieldErrors } from "@/lib/api-client";
import { adminEditPath, KIND_LABEL } from "@/lib/content/paths";
import type { ContentKind } from "@/lib/content/repository";
import { ENGINES, RESOURCE_CATEGORIES } from "@/lib/content/schemas";
import { useMutation } from "../asset-editor/use-mutation";
import { slugify } from "./fields";

/** Creates a draft with the few fields it can't exist without, then opens the full editor. */
export function NewContentForm({ kind }: { kind: ContentKind }) {
  const router = useRouter();
  const { busy, run } = useMutation();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nameKey = kind === "creator" ? "name" : "title";
  const label = KIND_LABEL[kind].one;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErrors({});
    const body: Record<string, unknown> = { [nameKey]: title, slug: slugEdited ? slug : slugify(title) };
    for (const k of ["engine", "url", "category"]) if (f.has(k)) body[k] = String(f.get(k));
    const r = await run(
      "create",
      () =>
        api<{ id: string }>(`/api/admin/content/${kind}`, { body }).catch((err) => {
          setErrors(fieldErrors(err));
          throw err;
        }),
      `${label} created as a draft`,
    );
    if (r) router.push(adminEditPath(kind, r.id));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-xl">
      <Panel title={`New ${label.toLowerCase()}`}>
        <div className="flex flex-col gap-4">
          <Field label={kind === "creator" ? "Name" : "Title"} error={errors[nameKey]} required>
            <Input name={nameKey} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus />
          </Field>
          <Field label="Slug" error={errors.slug} hint="The page address. Filled in from the title; change it if you like.">
            <Input
              name="slug"
              value={slugEdited ? slug : slugify(title)}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
              maxLength={80}
            />
          </Field>
          {kind === "shader" || kind === "starter" ? (
            <Field label="Engine" error={errors.engine} required>
              <Select name="engine" defaultValue={kind === "shader" ? "threejs" : "godot"}>
                {ENGINES.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {kind === "resource" ? (
            <>
              <Field label="Link" error={errors.url} required hint="The page people should visit, starting with https://.">
                <Input name="url" type="url" placeholder="https://" />
              </Field>
              <Field label="Category" error={errors.category} required>
                <Select name="category" defaultValue="tools">
                  {RESOURCE_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          <Button type="submit" variant="primary" size="lg" disabled={busy !== null || !title.trim()}>
            {busy ? "Creating…" : `Create ${label.toLowerCase()}`}
          </Button>
        </div>
      </Panel>
    </form>
  );
}
