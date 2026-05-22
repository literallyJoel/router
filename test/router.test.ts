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
