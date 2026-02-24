import { describe, expect, test } from "bun:test";
import { createController } from "../src/controller";
import type { StandardSchemaV1 } from "@standard-schema/spec";

function createMockRequest(
  overrides: Partial<Omit<Request, "body">> & { body?: string } = {},
) {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "test" }),
    ...overrides,
  }) as import("bun").BunRequest & {
    params?: Record<string, string | undefined>;
  };
}

function createGetRequest(url: string) {
  return new Request(url, {
    method: "GET",
  }) as import("bun").BunRequest & {
    params?: Record<string, string | undefined>;
  };
}

function createMockSchema<T>(
  validate: (input: unknown) =>
    | { value: T; issues?: undefined }
    | {
        value?: undefined;
        issues: Array<{ message: string; path?: unknown[] }>;
      },
): StandardSchemaV1<any, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate,
    },
  } as StandardSchemaV1<any, T>;
}

describe("createController", () => {
  test("returns 200 with JSON body when handler succeeds", async () => {
    const Controller = createController(
      async (c) => Response.json({ ok: true }),
      { requiresAuthentication: false },
    );
    const req = createMockRequest();
    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("returns 401 when requiresAuthentication and no session", async () => {
    const Controller = createController(
      async () => Response.json({ ok: true }),
      { requiresAuthentication: true },
    );
    const req = createMockRequest();
    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain("logged in");
  });

  test("succeeds when requiresAuthentication and session provided", async () => {
    const Controller = createController(
      async (c) => {
        expect(c.session).toEqual({ user: { id: 1 } });
        return Response.json({ ok: true });
      },
      { requiresAuthentication: true },
    );
    const req = createMockRequest();
    const session = { user: { id: 1 } };
    const instance = new Controller(req, { session });
    const res = await instance.invoke(session);
    expect(res.status).toBe(200);
  });

  test("uses ctx.session when invoke is called without a session argument", async () => {
    const session = { user: { id: 1 } };
    const Controller = createController(
      async (c) => {
        expect(c.session).toEqual(session);
        return Response.json({ ok: true });
      },
      { requiresAuthentication: true },
    );

    const req = createMockRequest();
    const instance = new Controller(req, { session });
    const res = await instance.invoke();

    expect(res.status).toBe(200);
  });

  test("validates JSON body with schema", async () => {
    const schema = createMockSchema<{ name: string }>((input) => {
      const obj = input as Record<string, unknown>;
      if (typeof obj?.name !== "string") {
        return { issues: [{ message: "name required", path: ["name"] }] };
      }
      return { value: { name: obj.name as string } };
    });
    const Controller = createController(
      async (c) => {
        expect(c.json).toEqual({ name: "test" });
        return Response.json({ name: c.json!.name });
      },
      {
        requiresAuthentication: false,
        validationSchema: schema,
      },
    );
    const req = createMockRequest({
      body: JSON.stringify({ name: "test" }),
    });
    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "test" });
  });

  test("returns 400 when schema validation fails", async () => {
    const schema = createMockSchema<{ name: string }>((_input) => ({
      issues: [{ message: "Invalid", path: ["name"] }],
    }));
    const Controller = createController(
      async () => Response.json({ ok: true }),
      {
        requiresAuthentication: false,
        validationSchema: schema,
      },
    );
    const req = createMockRequest({
      body: JSON.stringify({ name: "" }),
    });
    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: unknown };
    expect(body.fields).toEqual([{ field: "name", message: "Invalid" }]);
  });

  test("returns 400 for invalid JSON body", async () => {
    const schema = createMockSchema<{ x: number }>((input) => ({
      value: input as { x: number },
    }));
    const Controller = createController(
      async () => Response.json({ ok: true }),
      {
        requiresAuthentication: false,
        validationSchema: schema,
      },
    );
    const req = createMockRequest({
      body: "not valid json{{{",
    });
    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain("JSON");
  });

  test("validates UUID params and populates this.params", async () => {
    const Controller = createController(
      async (c) => {
        expect(c.params.id).toBe("550e8400-e29b-41d4-a716-446655440000");
        return Response.json({ id: c.params.id });
      },
      {
        requiresAuthentication: false,
        validateUUIDs: ["id"],
      },
    );
    const req = createMockRequest();
    req.params = { id: "550e8400-e29b-41d4-a716-446655440000" };
    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  test("returns 404 when UUID param is invalid", async () => {
    const Controller = createController(
      async () => Response.json({ ok: true }),
      {
        requiresAuthentication: false,
        validateUUIDs: ["id"],
      },
    );
    const req = createMockRequest();
    req.params = { id: "not-a-uuid" };
    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(404);
  });

  test("returns 404 when UUID param is missing", async () => {
    const Controller = createController(
      async () => Response.json({ ok: true }),
      {
        requiresAuthentication: false,
        validateUUIDs: ["id"],
      },
    );
    const req = createMockRequest();
    req.params = {};
    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(404);
  });

  test("runs additionalValidator and merges field errors", async () => {
    const schema = createMockSchema<{ email: string }>((input) => ({
      value: input as { email: string },
    }));
    const Controller = createController(
      async () => Response.json({ ok: true }),
      {
        requiresAuthentication: false,
        validationSchema: schema,
      },
      (validated) => {
        if (!validated.email.includes("@")) {
          return [{ field: "email", message: "Must be valid email" }];
        }
        return [];
      },
    );
    const req = createMockRequest({
      body: JSON.stringify({ email: "invalid" }),
    });
    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: unknown[] };
    expect(body.fields).toContainEqual({
      field: "email",
      message: "Must be valid email",
    });
  });

  test("supports async additionalValidator", async () => {
    const schema = createMockSchema<{ value: number }>((input) => ({
      value: input as { value: number },
    }));
    const Controller = createController(
      async () => Response.json({ ok: true }),
      {
        requiresAuthentication: false,
        validationSchema: schema,
      },
      async (validated) => {
        await Promise.resolve();
        return validated.value < 0
          ? [{ field: "value", message: "Must be positive" }]
          : [];
      },
    );
    const req = createMockRequest({
      body: JSON.stringify({ value: -1 }),
    });
    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: unknown[] };
    expect(body.fields).toContainEqual({
      field: "value",
      message: "Must be positive",
    });
  });

  test("exposes query params on controller.query", async () => {
    const Controller = createController(
      async (c) => {
        expect(c.query.page).toBe("1");
        expect(c.query.tag).toEqual(["bun", "router"]);
        expect(c.searchParams.get("page")).toBe("1");
        expect(c.searchParams.getAll("tag")).toEqual(["bun", "router"]);
        return Response.json({ query: c.query });
      },
      { requiresAuthentication: false },
    );

    const req = createGetRequest("http://localhost/test?page=1&tag=bun&tag=router");

    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      query: { page: "1", tag: ["bun", "router"] },
    });
  });

  test("validates query params with querySchema", async () => {
    const querySchema = createMockSchema<{ page: number; q: string }>((input) => {
      const query = input as Record<string, string | string[] | undefined>;
      const pageRaw = query.page;
      const qRaw = query.q;
      const page =
        typeof pageRaw === "string" ? Number.parseInt(pageRaw, 10) : NaN;

      if (!Number.isInteger(page) || page < 1 || typeof qRaw !== "string") {
        return {
          issues: [
            { message: "page must be a positive integer", path: ["page"] },
          ],
        };
      }

      return { value: { page, q: qRaw } };
    });

    const Controller = createController(
      async (c) => Response.json({ page: c.query.page, q: c.query.q }),
      { requiresAuthentication: false, querySchema },
    );

    const req = createGetRequest("http://localhost/test?page=2&q=search");

    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ page: 2, q: "search" });
  });

  test("returns 400 when querySchema validation fails", async () => {
    const querySchema = createMockSchema<{ page: number }>((_input) => ({
      issues: [{ message: "Invalid page", path: ["page"] }],
    }));

    const Controller = createController(
      async () => Response.json({ ok: true }),
      { requiresAuthentication: false, querySchema },
    );

    const req = createGetRequest("http://localhost/test?page=NaN");

    const instance = new Controller(req, { session: undefined });
    const res = await instance.invoke();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: unknown };
    expect(body.fields).toEqual([{ field: "page", message: "Invalid page" }]);
  });
});
