import { describe, expect, it } from "vitest";
import { externalUris, pickModel, resolveUri } from "./files";

describe("model file selection", () => {
  const files = [{ name: "scene.bin" }, { name: "wood planks.png" }, { name: "scene.gltf" }, { name: "rock.png", path: "pack/textures/rock.png" }];

  it("picks a GLB first, then a glTF", () => {
    expect(pickModel(files)?.name).toBe("scene.gltf");
    expect(pickModel([...files, { name: "a.GLB" }])?.name).toBe("a.GLB");
    expect(pickModel([{ name: "x.png" }])).toBeNull();
  });

  it("resolves URIs by path, then by name, decoding %20 and ./", () => {
    expect(resolveUri("scene.bin", files)?.name).toBe("scene.bin");
    expect(resolveUri("./textures/wood%20planks.png", files)?.name).toBe("wood planks.png");
    expect(resolveUri("textures/rock.png", files)?.path).toBe("pack/textures/rock.png");
    expect(resolveUri("TEXTURES\\Rock.PNG", files)?.name).toBe("rock.png");
    expect(resolveUri("missing.png", files)).toBeNull();
    expect(resolveUri("data:image/png;base64,AAAA", files)).toBeNull();
  });

  it("lists external buffers and images, skipping data URIs and embedded images", () => {
    expect(externalUris({ buffers: [{ uri: "a.bin" }, { uri: "data:application/octet-stream;base64,AA" }, {}], images: [{ uri: "t.png" }, { uri: 3 }] })).toEqual(["a.bin", "t.png"]);
  });
});
