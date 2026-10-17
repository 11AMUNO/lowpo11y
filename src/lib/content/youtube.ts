/**
 * Checks a YouTube video through the public oEmbed endpoint: it confirms the
 * video exists and is embeddable, and returns its title and channel so the
 * editor can compare them with the record. No API key, no scraping.
 */
export interface VideoCheck {
  title: string;
  authorName: string;
  authorUrl: string | null;
}

export class VideoCheckError extends Error {}

export async function checkYouTubeVideo(videoId: string, fetchImpl: typeof fetch = fetch): Promise<VideoCheck> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new VideoCheckError("That isn't a YouTube video id.");
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
  } catch {
    throw new VideoCheckError("YouTube didn't answer. Try again, or check the video by opening it.");
  }
  if (res.status === 401 || res.status === 403) throw new VideoCheckError("The video exists but its owner doesn't allow embedding. Link to it instead.");
  if (res.status === 404 || res.status === 400) throw new VideoCheckError("YouTube has no public video with that id. It may be private or removed.");
  if (!res.ok) throw new VideoCheckError(`YouTube answered ${res.status}. Try again later.`);
  const data = (await res.json().catch(() => null)) as { title?: unknown; author_name?: unknown; author_url?: unknown } | null;
  if (!data || typeof data.title !== "string" || typeof data.author_name !== "string") throw new VideoCheckError("YouTube's answer wasn't readable.");
  const authorUrl = typeof data.author_url === "string" && data.author_url.startsWith("https://www.youtube.com/") ? data.author_url : null;
  return { title: data.title.slice(0, 300), authorName: data.author_name.slice(0, 200), authorUrl };
}
