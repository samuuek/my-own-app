import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("production HTML contains the local app entry point and no remote runtime assets", () => {
  const html = fs.readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>木子工作台<\/title>/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.doesNotMatch(html, /https?:\/\/(fonts|cdn|unpkg|jsdelivr)\./i);
  assert.match(html, /\/assets\//);
});
