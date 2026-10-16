import { zipSync } from "fflate";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { writeGlb } from "@/lib/formats/glb-writer";
import { box } from "@/lib/formats/geometry";
import { imageSize } from "@/lib/formats/image-size";
import { ALLOWED_FORMATS, detectFormat, extensionOf, inspectZip, looksExecutable } from "./file-types";

const enc = (s: string) => new TextEncoder().encode(s);

describe("detectFormat", () => {
  it("identifies images by their bytes, not their names", async () => {
    const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: "#f00" } }).png().toBuffer();
    const jpg = await sharp({ create: { width: 5, height: 4, channels: 3, background: "#0f0" } }).jpeg().toBuffer();
    const webp = await sharp({ create: { width: 7, height: 6, channels: 3, background: "#00f" } }).webp().toBuffer();
    expect(detectFormat(png, "photo.jpg")?.format).toBe("png");
    expect(detectFormat(jpg, "x.png")?.format).toBe("jpg");
    expect(detectFormat(webp, "x")?.format).toBe("webp");
    expect(imageSize(png)).toMatchObject({ width: 3, height: 2 });
    expect(imageSize(jpg)).toMatchObject({ width: 5, height: 4 });
    expect(imageSize(webp)).toMatchObject({ width: 7, height: 6 });
  });

  it("identifies 3D formats", () => {
    const glb = writeGlb({ meshes: [{ primitives: [box(1, 1, 1)] }], nodes: [{ mesh: 0 }], roots: [0] });
    expect(detectFormat(glb, "model.bin")?.format).toBe("glb");
    expect(detectFormat(enc("Kaydara FBX Binary  \0\x1a\0"), "a.fbx")?.format).toBe("fbx");
    expect(detectFormat(enc("BLENDER-v300REND"), "scene.blend")?.format).toBe("blend");
    expect(detectFormat(enc('{"asset":{"version":"2.0"}}'), "a.gltf")?.format).toBe("gltf");
    expect(detectFormat(enc("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"), "tri.obj")?.format).toBe("obj");
  });

  it("refuses executables whatever their name", () => {
    expect(detectFormat(enc("MZ\x90\0\x03"), "texture.png")).toBeNull();
    expect(detectFormat(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]), "model.glb")).toBeNull();
    expect(detectFormat(enc("#!/bin/sh\nrm -rf /\n"), "notes.txt")).toBeNull();
    expect(looksExecutable(enc("MZ"))).toBe(true);
  });

  it("refuses unknown binary and mislabelled text", () => {
    expect(detectFormat(Uint8Array.from([1, 2, 3, 0, 5]), "x.dat")).toBeNull();
    expect(detectFormat(enc("hello"), "x.exe")).toBeNull();
    expect(detectFormat(enc("{not json"), "a.json")).toBeNull();
    expect(detectFormat(new Uint8Array(), "a.png")).toBeNull();
  });

  it("only allows images for thumbnails", () => {
    expect(ALLOWED_FORMATS.thumbnail).toEqual(["png", "jpg", "webp", "gif"]);
    expect(ALLOWED_FORMATS.delivery).toContain("fbx");
    expect(ALLOWED_FORMATS.delivery).not.toContain("exe");
  });

  it("extracts extensions safely", () => {
    expect(extensionOf("My Model.FBX")).toBe("fbx");
    expect(extensionOf("noext")).toBe("");
    expect(extensionOf("weird.name.tar.gz")).toBe("gz");
  });
});

describe("inspectZip", () => {
  it("lists entries of a clean archive", () => {
    const zip = zipSync({ "pack/readme.txt": enc("hi"), "pack/model.glb": new Uint8Array(4) });
    expect(inspectZip(zip)).toEqual({ entries: ["pack/readme.txt", "pack/model.glb"], problems: [] });
  });

  it("flags executables and path traversal", () => {
    const zip = zipSync({ "setup.exe": enc("MZ"), "../escape.txt": enc("x"), "run.sh": enc("#!") });
    const { problems } = inspectZip(zip);
    expect(problems.join("\n")).toMatch(/setup\.exe/);
    expect(problems.join("\n")).toMatch(/\.\.\/escape/);
    expect(problems.join("\n")).toMatch(/run\.sh/);
  });

  it("reports damaged archives", () => {
    expect(inspectZip(enc("PK\x03\x04garbage")).problems[0]).toMatch(/damaged/);
  });
});
