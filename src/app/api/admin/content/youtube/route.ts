import { staffRequest } from "@/lib/admin-api";
import { hitRateLimit } from "@/lib/auth/rate-limit";
import { parseYouTubeId } from "@/lib/content/schemas";
import { checkYouTubeVideo, VideoCheckError } from "@/lib/content/youtube";
import { SERVICE, withDb } from "@/lib/db";
import { badRequest, HttpError, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Looks a video up on YouTube (oEmbed) so editors can confirm it exists and who made it. */
export const GET = route(async (request: Request) => {
  const s = await staffRequest(request);
  const id = parseYouTubeId(new URL(request.url).searchParams.get("v") ?? "");
  if (!id) throw badRequest("That isn't a YouTube video link or id.");
  const rl = await withDb(SERVICE, (q) => hitRateLimit(q, `oembed:${s.user.id}`, 60, 10 * 60));
  if (!rl.ok) throw new HttpError(429, "Too many checks. Wait a few minutes.", "rate_limited");
  try {
    return Response.json({ id, ...(await checkYouTubeVideo(id)) });
  } catch (e) {
    if (e instanceof VideoCheckError) throw new HttpError(422, e.message, "video_check_failed");
    throw e;
  }
});
