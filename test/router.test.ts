import { describe, expect, test } from "bun:test";
import { createRouter } from "../src/router";
import path from "path";

const fixturesDir = path.join(import.meta.dir, "fixtures", "routes");

type RouteHandler = (
  req: Request,
  server: unknown,
) => Response | Promise<Response>;
function getHandler(route: unknown): RouteHandler | undefined {
  if (typeof route === "function") return route as RouteHandler;
  const map = route as Partial<Record<string, RouteHandler>> | undefined;
  return map?.GET ?? map?.POST;
}

describe("createRouter getRoutes", () => {
  test("returns empty object for directory with no route files", async () => {
    const { getRoutes } = createRouter({
      routesDirectory: path.join(import.meta.dir, "fixtures", "empty"),
    });
    const routes = await getRoutes();
    expect(routes).toEqual({});
  });

  test("discovers routes from directory structure", async () => {
    const { getRoutes } = createRouter({
      routesDirectory: fixturesDir,
    });
    const routes = await getRoutes();
    expect(routes["/"]).toBeDefined();
    expect(routes["/users"]).toBeDefined();
    expect(routes["/users/[id]"]).toBeDefined();
    expect(routes["/session"]).toBeDefined();
  });

  test("GET / returns 200 with correct body", async () => {
    const { getRoutes } = createRouter({ routesDirectory: fixturesDir });
    const routes = await getRoutes();
    const handler = getHandler(routes["/"]);
    if (typeof handler !== "function") {
      throw new Error("Expected function handler");
    }
    const req = new Request("http://localhost/");
    const res = await handler(req, {} as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: "GET" });
  });

  test("POST /users returns 200 with correct body", async () => {
    const { getRoutes } = createRouter({ routesDirectory: fixturesDir });
    const routes = await getRoutes();
    const handler = (routes["/users"] as Partial<Record<"POST", RouteHandler>>)
      ?.POST;
    if (typeof handler !== "function") {
      throw new Error("Expected function handler");
    }
    const req = new Request("http://localhost/users", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req, {} as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: "POST", path: "/users" });
  });

  test("calls sessionGetter when provided", async () => {
    let sessionGetterCalled = false;
    const { getRoutes } = createRouter({
      routesDirectory: fixturesDir,
      sessionGetter: async () => {
        sessionGetterCalled = true;
        return { user: { id: 1 } };
      },
    });
    const routes = await getRoutes();
    const handler = getHandler(routes["/"]);
    if (typeof handler !== "function") {
      throw new Error("Expected function handler");
    }
    const req = new Request("http://localhost/");
    await handler(req, {} as any);
    expect(sessionGetterCalled).toBe(true);
  });

  test("passes request headers and request object to sessionGetter", async () => {
    const observed: { auth: string | null; url?: string } = { auth: null };

    const { getRoutes } = createRouter({
      routesDirectory: fixturesDir,
      sessionGetter: async (headers, request) => {
        observed.auth = headers.get("authorization");
        observed.url = request.url;
        return { user: { id: "user_123", role: "admin" as const } };
      },
    });

    const routes = await getRoutes();
    const handler = getHandler(routes["/"]);
    if (typeof handler !== "function") {
      throw new Error("Expected function handler");
    }

    await handler(
      new Request("http://localhost/?from=test", {
        headers: { authorization: "Bearer test-token" },
      }),
      {} as any,
    );

    expect(observed.auth).toBe("Bearer test-token");
    expect(observed.url).toBe("http://localhost/?from=test");
  });

  test("passes resolved session into authenticated controllers", async () => {
    const { getRoutes } = createRouter({
      routesDirectory: fixturesDir,
      sessionGetter: async (headers) => {
        const token = headers.get("authorization");
        return token
          ? { user: { id: "user_123", role: "admin" as const } }
          : null;
      },
    });

    const routes = await getRoutes();
    const handler = getHandler(routes["/session"]);
    if (typeof handler !== "function") {
      throw new Error("Expected function handler");
    }

    const res = await handler(
      new Request("http://localhost/session", {
        headers: { authorization: "Bearer test-token" },
      }),
      {} as any,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "user_123",
      ctxUserId: "user_123",
      role: "admin",
    });
  });

  test("returns 401 for authenticated controllers when sessionGetter returns null", async () => {
    const { getRoutes } = createRouter({
      routesDirectory: fixturesDir,
      sessionGetter: async () => null,
    });

    const routes = await getRoutes();
    const handler = getHandler(routes["/session"]);
    if (typeof handler !== "function") {
      throw new Error("Expected function handler");
    }

    const res = await handler(
      new Request("http://localhost/session"),
      {} as any,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain("logged in");
  });

  test("applies routePrefix", async () => {
    const { getRoutes } = createRouter({
      routesDirectory: fixturesDir,
      routePrefix: "/api",
    });
    const routes = await getRoutes();
    // Root route becomes /api/ (prefix + /)
    expect(routes["/api/"]).toBeDefined();
    expect(routes["/api/users"]).toBeDefined();
    expect(routes["/api/users/[id]"]).toBeDefined();
  });

  test("preserves directory casing in route paths", async () => {
    const { getRoutes } = createRouter({
      routesDirectory: fixturesDir,
    });
    const routes = await getRoutes();

    expect(routes["/CamelCase"]).toBeDefined();
    expect(routes["/camelcase"]).toBeUndefined();
  });
});


describe("createRouter", () => {
  test("returns bound route and controller helpers", async () => {
    let sessionGetterCalled = false;
    const { createController, getRoutes: getBoundRoutes } = createRouter({
      routesDirectory: fixturesDir,
      sessionGetter: async () => {
        sessionGetterCalled = true;
        return { user: { id: "user_1", role: "admin" as const } };
      },
    });

    const Controller = createController(
      async (ctrl) => {
        expect(ctrl.session.user.id).toBe("user_1");
        expect(ctrl.user.role).toBe("admin");
        return Response.json({ userId: ctrl.ctx.session.user.id });
      },
      { requiresAuthentication: true },
    );

    const instance = new Controller(new Request("http://localhost/me") as any, {
      session: { user: { id: "user_1", role: "admin" } },
    });

    const controllerResponse = await instance.invoke();
    expect(controllerResponse.status).toBe(200);
    expect(await controllerResponse.json()).toEqual({ userId: "user_1" });

    const routes = await getBoundRoutes();
    const handler = getHandler(routes["/"]);
    if (typeof handler !== "function") {
      throw new Error("Expected function handler");
    }

    await handler(new Request("http://localhost/"), {} as any);
    expect(sessionGetterCalled).toBe(true);
  });
});
