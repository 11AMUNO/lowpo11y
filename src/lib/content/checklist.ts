/**
 * What publishing (or approving) needs, mirroring the database triggers in
 * migration 006. Shared by the admin editor (live, from the form) and the
 * server. The database is the authority; this is the explanation.
 */
import type { ContentKind } from "./repository";

export interface CheckItem {
  label: string;
  ok: boolean;
}

export function publishChecklist(kind: ContentKind, row: Record<string, unknown>, ctx: { licenceKnown?: boolean; creatorApproved?: boolean } = {}): CheckItem[] {
  const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  switch (kind) {
    case "shader":
      return [
        { label: "A known licence", ok: !!ctx.licenceKnown },
        { label: "Tested: date and what it was tested with", ok: !!row.tested_at },
        { label: "Code or a download file", ok: filled(row.code) || !!row.file_key },
        { label: "Explanation", ok: filled(row.explanation_md) },
        { label: "Setup steps", ok: filled(row.setup_md) },
        { label: "Limitations", ok: filled(row.limitations_md) },
      ];
    case "starter":
      return [
        { label: "A known licence", ok: !!ctx.licenceKnown },
        { label: "Tested: date and engine version", ok: !!row.tested_at },
        { label: "A download file", ok: !!row.file_key },
        { label: "Description", ok: filled(row.description_md) },
      ];
    case "creator":
      return [
        { label: "Description in our own words", ok: filled(row.description) },
        { label: "Channel or website link", ok: !!(row.youtube_channel_url || row.website_url) },
        { label: "Review date", ok: !!row.last_reviewed_at },
      ];
    case "tutorial":
      return [
        { label: "A YouTube video or link", ok: !!(row.youtube_video_id || row.external_url) },
        { label: "Summary of what viewers will learn", ok: filled(row.summary) },
        { label: "Review date", ok: !!row.last_reviewed_at },
        { label: "An approved creator", ok: !!ctx.creatorApproved },
      ];
    case "resource":
      return [
        { label: "An https link", ok: typeof row.url === "string" && row.url.startsWith("https://") },
        { label: "Description", ok: filled(row.description) },
        { label: "Review date", ok: !!row.last_reviewed_at },
      ];
  }
}
