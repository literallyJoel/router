import { describe, expect, test } from "bun:test";
import {
  validateUUID,
  parseStandardSchema,
  type UUIDVersion,
} from "../src/validation";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ValidationError } from "../src/errors/GenericErrors";

describe("validateUUID", () => {
  test("accepts valid UUID v4", () => {
    expect(validateUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  test("accepts valid UUID v1", () => {
    expect(validateUUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true);
  });

  test("accepts uppercase hex", () => {
    expect(validateUUID("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  test("rejects invalid format - wrong length", () => {
    expect(validateUUID("550e8400-e29b-41d4-a716-44665544000")).toBe(false);
  });

  test("rejects invalid format - wrong variant nibble", () => {
    expect(validateUUID("550e8400-e29b-41d4-c716-446655440000")).toBe(false);
  });

  test("rejects invalid format - wrong version", () => {
    expect(validateUUID("550e8400-e29b-01d4-a716-446655440000")).toBe(false);
  });

  test("rejects non-hex characters", () => {
    expect(validateUUID("550e8400-e29b-41d4-a716-44665544000g")).toBe(false);
  });

  test("validates specific version when provided", () => {
    expect(validateUUID("550e8400-e29b-41d4-a716-446655440000", 4)).toBe(true);
    expect(validateUUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8", 1)).toBe(true);
    expect(validateUUID("550e8400-e29b-41d4-a716-446655440000", 1)).toBe(false);
  });

  test("throws for invalid version number", () => {
    expect(() =>
      validateUUID("550e8400-e29b-41d4-a716-446655440000", 0 as UUIDVersion),
    ).toThrow("Invalid UUID version");
    expect(() =>
      validateUUID("550e8400-e29b-41d4-a716-446655440000", 9 as UUIDVersion),
    ).toThrow("Invalid UUID version");
  });
});

function createMockSchema<T>(
  validate: (input: unknown) =>
    | { value: T; issues?: undefined }
    | {
        value?: undefined;
        issues: Array<{ message: string; path?: unknown[] }>;
      }
    | Promise<
        | { value: T; issues?: undefined }
        | {
            value?: undefined;
            issues: Array<{ message: string; path?: unknown[] }>;
          }
      >,
): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate,
    },
  } as StandardSchemaV1<unknown, T>;
}

describe("parseStandardSchema", () => {
  test("returns validated value on success", async () => {
    const schema = createMockSchema<{ name: string }>((input) => ({
      value: input as { name: string },
    }));
    const result = await parseStandardSchema({ name: "test" }, schema);
    expect(result).toEqual({ name: "test" });
  });

  test("handles sync validate", async () => {
    const schema = createMockSchema<number>((input) => ({
      value: Number(input),
    }));
    const result = await parseStandardSchema("42", schema);
    expect(result).toBe(42);
  });

  test("handles async validate", async () => {
    const schema = createMockSchema<string>((input) =>
      Promise.resolve({ value: String(input) }),
    );
    const result = await parseStandardSchema(123, schema);
    expect(result).toBe("123");
  });

  test("throws ValidationError with fieldErrors on failure", async () => {
    const schema = createMockSchema<unknown>((_input) => ({
      issues: [{ message: "Invalid", path: ["name"] }],
    }));
    const err = await parseStandardSchema({}, schema).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as InstanceType<typeof ValidationError>).fieldErrors).toEqual([
      { field: "name", message: "Invalid" },
    ]);
  });

  test("throws ValidationError for non-StandardSchemaV1", async () => {
    const badSchema = {
      "~standard": { version: 2 },
    } as unknown as StandardSchemaV1<unknown, unknown>;
    await expect(parseStandardSchema({}, badSchema)).rejects.toThrow(
      "Schema does not implement StandardSchemaV1",
    );
  });

  test("throws ValidationError for schema without validate function", async () => {
    const badSchema = {
      "~standard": { version: 1, vendor: "test" },
    } as unknown as StandardSchemaV1<unknown, unknown>;
    await expect(parseStandardSchema({}, badSchema)).rejects.toThrow(
      "Schema does not implement StandardSchemaV1",
    );
  });
});
