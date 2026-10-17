import { describe, expect, it } from "vitest";
import { parsePatch, parseYouTubeId, shaderInputSchema, tutorialInputSchema } from "./schemas";

describe("parseYouTubeId", () => {
  it.each([
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("reads %s", (input, id) => expect(parseYouTubeId(input)).toBe(id));

  it.each(["https://vimeo.com/123", "https://www.youtube.com/@channel", "https://evil.test/watch?v=dQw4w9WgXcQ", "short", "https://youtu.be/toolongvideoid1"])("rejects %s", (input) =>
    expect(parseYouTubeId(input)).toBeNull(),
  );
});

describe("parsePatch", () => {
  it("keeps only the fields that were sent", () => {
    expect(parsePatch(shaderInputSchema, { title: " New title ", featured: true })).toEqual({ title: "New title", featured: true });
  });

  it("still validates and normalises what was sent", () => {
    expect(parsePatch(tutorialInputSchema, { youtube_video_id: "https://youtu.be/dQw4w9WgXcQ", external_url: "" })).toEqual({ youtube_video_id: "dQw4w9WgXcQ", external_url: null });
    expect(() => parsePatch(shaderInputSchema, { slug: "Not A Slug" })).toThrow();
  });
});
