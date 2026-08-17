// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = path.join(process.cwd(), "database", "cloud", "001_workspace.sql");

describe("cloud workspace schema", () => {
  it("defines the required workspace tables and indexes", () => {
    const schema = fs.readFileSync(schemaPath, "utf8");

    for (const requiredFragment of [
      "workspace_schema_migrations",
      "workspace_entities",
      "workspace_settings",
      "workspace_daily_reviews",
      "workspace_blob_cleanup",
      "PRIMARY KEY (collection, id)",
      "payload JSONB",
      "jsonb_typeof(payload) = 'object'",
      "payload ? 'id'",
      "jsonb_typeof(payload->'id') = 'string'",
      "payload->>'id' = id",
      "idx_workspace_entities_active",
      "idx_workspace_entities_updated",
      "uq_workspace_active_focus_timer",
      "idx_workspace_blob_cleanup_due",
    ]) {
      expect(schema).toContain(requiredFragment);
    }
  });
});
