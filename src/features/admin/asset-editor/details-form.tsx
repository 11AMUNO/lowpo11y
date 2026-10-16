"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, fieldErrors } from "@/lib/api-client";
import { ASSET_TYPE_LABEL, ASSET_TYPES, ENGINES } from "@/lib/assets/schemas";
import type { EditorAsset, Option } from "./types";
import { useMutation } from "./use-mutation";

export function DetailsForm({ asset, categories, readOnly }: { asset: EditorAsset; categories: Option[]; readOnly: boolean }) {
  const { busy, run } = useMutation();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [short, setShort] = useState(asset.shortDescription);
  const [engines, setEngines] = useState<string[]>(asset.engines);
  const [featured, setFeatured] = useState(asset.featured);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErrors({});
    const body = {
      title: String(f.get("title")),
      slug: String(f.get("slug")),
      assetType: String(f.get("assetType")),
      shortDescription: short,
      categoryId: String(f.get("categoryId")) || null,
      tags: String(f.get("tags"))
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      engines,
      featured,
      descriptionMd: String(f.get("descriptionMd")),
      usageNotesMd: String(f.get("usageNotesMd")),
    };
    await run(
      "details",
      () =>
        api(`/api/admin/assets/${asset.id}`, { method: "PATCH", body }).catch((err) => {
          setErrors(fieldErrors(err));
          throw err;
        }),
      "Details saved",
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate aria-label="Asset details">
      <fieldset disabled={readOnly} className="contents">
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <Field label="Title" error={errors.title} required>
            <Input name="title" defaultValue={asset.title} maxLength={120} required />
          </Field>
          <Field label="Type">
            <Select name="assetType" defaultValue={asset.assetType}>
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <Field label="Slug" error={errors.slug} hint="Lowercase words and hyphens. Changing it breaks old links.">
            <Input name="slug" defaultValue={asset.slug} maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" />
          </Field>
          <Field label="Category">
            <Select name="categoryId" defaultValue={asset.categoryId ?? ""}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Short description" error={errors.shortDescription} aside={`${short.length}/240`} hint="One sentence for cards and search results.">
          <Input name="shortDescription" value={short} onChange={(e) => setShort(e.target.value)} maxLength={240} />
        </Field>
        <Field label="Tags" error={errors.tags} hint="Comma-separated, e.g. crate, industrial, psx-inspired. Style and setting tags become filters.">
          <Input name="tags" defaultValue={asset.tags.join(", ")} />
        </Field>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="type-label mb-1">Tested in</legend>
            <div className="flex flex-wrap gap-4">
              {ENGINES.map((en) => (
                <Checkbox
                  key={en}
                  label={en[0]!.toUpperCase() + en.slice(1)}
                  checked={engines.includes(en)}
                  disabled={readOnly}
                  onCheckedChange={(v) => setEngines((list) => (v ? [...list, en] : list.filter((x) => x !== en)))}
                />
              ))}
            </div>
          </fieldset>
          <Checkbox label="Featured" description="Listed first in the catalogue." checked={featured} disabled={readOnly} onCheckedChange={setFeatured} />
        </div>
        <Field label="Description" error={errors.descriptionMd} hint="Markdown. Headings, lists, links and code are allowed; HTML is removed.">
          <Textarea name="descriptionMd" defaultValue={asset.descriptionMd} rows={6} />
        </Field>
        <Field label="Usage notes" error={errors.usageNotesMd} hint="Import settings, scale, pivot, texture filtering.">
          <Textarea name="usageNotesMd" defaultValue={asset.usageNotesMd} rows={4} />
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={busy !== null || readOnly}>
            {busy === "details" ? "Saving…" : "Save details"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
