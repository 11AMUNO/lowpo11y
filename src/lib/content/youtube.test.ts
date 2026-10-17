import { describe, expect, it } from "vitest";
import { checkYouTubeVideo, VideoCheckError } from "./youtube";

const reply = (status: number, body?: unknown) => (async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("checkYouTubeVideo", () => {
  it("returns the title and channel from oEmbed", async () => {
    let asked = "";
    const fetchImpl = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ title: "Lighting", author_name: "Channel", author_url: "https://www.youtube.com/@channel" }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(checkYouTubeVideo("dQw4w9WgXcQ", fetchImpl)).resolves.toEqual({ title: "Lighting", authorName: "Channel", authorUrl: "https://www.youtube.com/@channel" });
    expect(asked).toBe("https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ");
  });

  it.each([
    [404, /no public video/],
    [401, /doesn't allow embedding/],
    [500, /answered 500/],
  ])("explains a %i", async (status, message) => {
    await expect(checkYouTubeVideo("dQw4w9WgXcQ", reply(status))).rejects.toThrow(message);
  });

  it("refuses bad ids and unreadable answers, and drops non-YouTube author links", async () => {
    await expect(checkYouTubeVideo("../../etc", reply(200))).rejects.toThrow(VideoCheckError);
    await expect(checkYouTubeVideo("dQw4w9WgXcQ", reply(200, { nope: 1 }))).rejects.toThrow(/readable/);
    await expect(checkYouTubeVideo("dQw4w9WgXcQ", reply(200, { title: "T", author_name: "A", author_url: "https://evil.test" }))).resolves.toMatchObject({ authorUrl: null });
  });
});
