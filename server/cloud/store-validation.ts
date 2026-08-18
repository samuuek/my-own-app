import {
  collectionDefinitions,
  isCollectionName,
  type CollectionName,
} from "../collections.js";
import { ValidationError } from "../errors.js";
import { validateBookProgress } from "../reading.js";
import { validateSourceCategory } from "../reflection.js";
import type { Entity } from "../store.js";
import { validateWorkbenchEntity } from "../workbench.js";

export function assertCollectionName(value: string): asserts value is CollectionName {
  if (!isCollectionName(value)) throw new ValidationError(`无效 collection：${value}`);
}

export function sanitizeCloudEntity(name: CollectionName, input: Entity): Entity {
  const allowed = new Set<string>(collectionDefinitions[name].fields);
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]),
  );
}

export function validateCloudCreate(name: CollectionName, input: Entity): void {
  requireFields(collectionDefinitions[name].required, input);
  validateWorkbenchEntity(name, null, input);
  validateBook(name, input);
  validateReflectionSource(name, input);
}

export function validateCloudUpdate(name: CollectionName, current: Entity, input: Entity): void {
  validateWorkbenchEntity(name, current, input);
  validateBook(name, { ...current, ...input });
  validateReflectionSource(name, input);
  if (Object.keys(input).length === 0) throw new ValidationError("没有可更新的内容");
}

function requireFields(required: readonly string[], input: Entity): void {
  const missing = required.filter((field) => input[field] === undefined || input[field] === null || input[field] === "");
  if (missing.length) throw new ValidationError(`请填写必填内容：${missing.join("、")}`);
}

function validateBook(name: CollectionName, input: Entity): void {
  if (name !== "books") return;
  validateBookProgress(
    Number(input.current_page ?? 0),
    input.total_pages == null ? null : Number(input.total_pages),
  );
}

function validateReflectionSource(name: CollectionName, input: Entity): void {
  if ((name === "dailyReflections" || name === "thoughtNotes") && input.source_category !== undefined) {
    validateSourceCategory(input.source_category);
  }
}
