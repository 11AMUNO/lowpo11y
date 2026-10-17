import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createImage, setPixel } from "@/lib/processing/image";
import { encodePng } from "./png";

describe("encodePng", () => {
  it("round-trips exact RGBA bytes, including semi-transparent pixels", async () => {
    const img = createImage(37, 19);
    for (let y = 0; y < 19; y++) for (let x = 0; x < 37; x++) setPixel(img, x, y, [(x * 13) % 256, (y * 29) % 256, (x * y) % 256, (x * 7 + y) % 256]);
    const png = encodePng(img);
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([37, 19, 4]);
    expect(Buffer.from(img.data).equals(data)).toBe(true);
  });

  it("is deterministic and compresses flat images well", () => {
    const flat = createImage(256, 256, [120, 80, 40, 255]);
    const a = encodePng(flat);
    expect(a).toEqual(encodePng(flat));
    expect(a.length).toBeLessThan(2000);
  });
});
