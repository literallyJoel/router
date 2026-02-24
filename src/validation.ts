import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ValidationError } from "./errors/GenericErrors";
import type { FieldError } from "./errors/ResponseError";

const UUID_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
/** Supported UUID versions for path-param validation. */
export type UUIDVersion = (typeof UUID_VERSIONS)[number];

/**
 * Validates/parses unknown input using a Standard Schema V1 schema.
 * Throws `ValidationError` when schema shape or validation output is invalid.
 */
export async function parseStandardSchema<T>(
  input: unknown,
  schema: StandardSchemaV1<any, T>,
): Promise<T> {
  const props = (schema as StandardSchemaV1)["~standard"];
  if (!props || props.version !== 1 || typeof props.validate !== "function") {
    throw new ValidationError({
      message: "Schema does not implement StandardSchemaV1",
    });
  }

  const result = props.validate(input);
  const resolved = result instanceof Promise ? await result : result;

  if (!resolved || typeof resolved !== "object") {
    throw new ValidationError({
      message: "Schema returned invalid validation result",
    });
  }

  if (
    "issues" in resolved &&
    Array.isArray(resolved.issues) &&
    resolved.issues.length > 0
  ) {
    const fieldErrors = mapIssues(resolved.issues);
    throw new ValidationError({ fieldErrors });
  }

  if (!("value" in resolved)) {
    throw new ValidationError({
      message: "Schema returned invalid validation result",
    });
  }

  return resolved.value as T;
}

/** Returns whether a UUID is valid for any supported version or a specific one. */
export function validateUUID(uuid: string, version?: UUIDVersion): boolean {
  if (version !== undefined) {
    if (version < 1 || version > 8) {
      throw new Error("Invalid UUID version. Must be between 1 and 8.");
    }
  }

  const versionPattern = version !== undefined ? `[${version}]` : `[1-8]`;

  const re = new RegExp(
    `^[0-9a-fA-F]{8}-` +
      `[0-9a-fA-F]{4}-` +
      `${versionPattern}[0-9a-fA-F]{3}-` +
      `[89abAB][0-9a-fA-F]{3}-` +
      `[0-9a-fA-F]{12}$`,
  );

  return re.test(uuid);
}

/** Converts Standard Schema issues into the public field-error format. */
function mapIssues(
  issues: ReadonlyArray<StandardSchemaV1.Issue>,
): FieldError[] {
  return issues.map((i) => ({
    field: formatPath(i.path),
    message: i.message ?? "Invalid",
  }));
}

/** Formats a Standard Schema path into a dot/bracket field path string. */
function formatPath(
  path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment> | undefined,
): string {
  if (!path || path.length === 0) return "";
  return path
    .map((seg) => {
      const key =
        typeof seg === "object" && seg && "key" in seg
          ? (seg as StandardSchemaV1.PathSegment).key
          : (seg as PropertyKey);
      return typeof key === "number" ? `[${key}]` : String(key);
    })
    .join(".");
}
