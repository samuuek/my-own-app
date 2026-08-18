import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appAssets = path.join(root, "public", "assets", "app");

function pngSize(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${path.basename(file)} should be a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function icoSizes(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt16LE(0), 0, "ICO reserved field should be zero");
  assert.equal(bytes.readUInt16LE(2), 1, "ICO type should identify an icon");
  const count = bytes.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    return {
      width: bytes[offset] || 256,
      height: bytes[offset + 1] || 256,
    };
  });
}

test("generates the approved application icon sizes", () => {
  const pngs = new Map([
    ["app-icon-1024-v2.png", 1024],
    ["app-icon-brand-512-v2.png", 512],
    ["apple-touch-icon-180-v2.png", 180],
    ["favicon-64-v2.png", 64],
  ]);

  for (const [name, size] of pngs) {
    assert.deepEqual(pngSize(path.join(appAssets, name)), { width: size, height: size });
  }

  assert.deepEqual(icoSizes(path.join(appAssets, "muzi-workspace-v2.ico")), [
    { width: 16, height: 16 },
    { width: 24, height: 24 },
    { width: 32, height: 32 },
    { width: 48, height: 48 },
    { width: 64, height: 64 },
    { width: 128, height: 128 },
    { width: 256, height: 256 },
  ]);
});

test("keeps every business module artwork asset", () => {
  const moduleDirectory = path.join(root, "public", "assets", "module-icons");
  const expected = [
    "consulting-v1.webp",
    "dashboard-v1.webp",
    "development-v1.webp",
    "diet-v1.webp",
    "entertainment-v1.webp",
    "fitness-v1.webp",
    "media-v1.webp",
    "reading-v1.svg",
    "reflection-v1.svg",
    "settings-v1.webp",
    "today-v1.webp",
  ];

  assert.deepEqual(fs.readdirSync(moduleDirectory).sort(), expected);
});
