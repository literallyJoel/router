import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ValidationError } from "./errors/GenericErrors";
import type { FieldError } from "./errors/ResponseError";

export async function parseStandardSchema<T>(
  input: unknown,
  schema: StandardSchemaV1<any, T>
): Promise<T> {
  const props = (schema as StandardSchemaV1)["~standard"];
  if (!props || props.version !== 1 || typeof props.validate !== "function") {
    throw new ValidationError({
      message: "Schema does not implement StandardSchemaV1",
    });
  }

  const result = props.validate(input);
  const resolved = result instanceof Promise ? await result : result;

  if (resolved.issues) {
    const fieldErrors = mapIssues(resolved.issues);
    throw new ValidationError({ fieldErrors });
  }

  return resolved.value as T;
}

export function validateUUID(uuid: string) {
  const re =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  return re.test(uuid);
}

function mapIssues(
  issues: ReadonlyArray<StandardSchemaV1.Issue>
): FieldError[] {
  return issues.map((i) => ({
    field: formatPath(i.path),
    message: i.message ?? "Invalid",
  }));
}

function formatPath(
  path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment> | undefined
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
