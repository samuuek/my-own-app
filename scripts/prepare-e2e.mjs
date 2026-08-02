import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.resolve(projectRoot, ".test-data", "e2e");
const expectedParent = path.resolve(projectRoot, ".test-data");
if (!target.startsWith(`${expectedParent}${path.sep}`) || path.basename(target) !== "e2e") {
  throw new Error("Refusing to clean an unexpected E2E directory");
}
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
