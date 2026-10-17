import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { inspectProjectZip } from "./files";
import { zipEntries } from "./zip-entries";

const text = (s: string) => strToU8(s);

describe("starter project ZIPs", () => {
  it("read names, sizes and symlinks from the central directory", () => {
    const zip = zipSync({ "project.godot": text("config_version=5\n"), "scenes/": new Uint8Array(), "link": [text("../../etc/passwd"), { os: 3, attrs: (0o120777 << 16) >>> 0 }] });
    const entries = zipEntries(zip);
    expect(entries.map((e) => [e.name, e.size, e.symlink, e.directory])).toEqual([
      ["project.godot", 17, false, false],
      ["scenes/", 0, false, true],
      ["link", 16, true, false],
    ]);
  });

  it("accept a plain project", () => {
    expect(inspectProjectZip(zipSync({ "project.godot": text("config_version=5\n"), "main.gd": text("extends Node\n"), "icon.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) }))).toEqual([]);
  });

  it("refuse symlinks, executables without an extension, scripts, unsafe paths and bombs", () => {
    expect(inspectProjectZip(zipSync({ "a.gd": text("x"), "link": [text("/etc"), { os: 3, attrs: (0o120777 << 16) >>> 0 }] }))).toEqual(["Symbolic links aren't allowed in projects: link"]);
    expect(inspectProjectZip(zipSync({ "bin/tool": new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]) }))).toEqual(["Binaries aren't allowed in projects: bin/tool is an executable."]);
    expect(inspectProjectZip(zipSync({ "run.sh": text("echo hi") }))[0]).toMatch(/shell scripts/);
    expect(inspectProjectZip(zipSync({ "../escape.gd": text("x") }))[0]).toMatch(/Unsafe path/);
    expect(inspectProjectZip(zipSync({ "zeros.bin": new Uint8Array(4096) }, { level: 9 }), 1000)[0]).toMatch(/unpacks to/);
    expect(inspectProjectZip(new Uint8Array([1, 2, 3]))).toEqual(["The file isn't a readable ZIP archive."]);
    expect(inspectProjectZip(zipSync({}))).toEqual(["The ZIP is empty."]);
  });
});
