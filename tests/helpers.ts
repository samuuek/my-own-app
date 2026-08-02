import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeTestDirectory(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `muzi-${label}-`));
}

export function removeTestDirectory(directory: string): void {
  const resolved = path.resolve(directory);
  if (!path.basename(resolved).startsWith("muzi-")) throw new Error("Refusing to remove an unexpected test directory");
  fs.rmSync(resolved, { recursive: true, force: true });
}
