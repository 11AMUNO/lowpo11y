import { z } from "@/lib/zod";
import { HttpError } from "@/lib/http";
import { CONTENT_KINDS, type ContentKind } from "./repository";

/** The `[kind]` segment of a content admin route; anything else is a 404. */
export function kindParam(v: string): ContentKind {
  if (!(CONTENT_KINDS as string[]).includes(v)) throw new HttpError(404, "Not found.", "not_found");
  return v as ContentKind;
}

export function idParam(v: string, what = "Item"): string {
  if (!z.uuid().safeParse(v).success) throw new HttpError(404, `${what} not found.`, "not_found");
  return v;
}

/** Shaders and starter projects carry downloadable files. */
export const hasFile = (k: ContentKind): k is "shader" | "starter" => k === "shader" || k === "starter";
