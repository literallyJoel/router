import { describe, expect, test } from "bun:test";
import { getRoutes } from "../src/router";
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

describe("getRoutes", () => {
  test("returns empty object for directory with no route files", async () => {
    const routes = await getRoutes({
      routesDirectory: path.join(import.meta.dir, "fixtures", "empty"),
    });
    expect(routes).toEqual({});
  });

  test("discovers routes from directory structure", async () => {
    const routes = await getRoutes({
      routesDirectory: fixturesDir,
    });
    expect(routes["/"]).toBeDefined();
    expect(routes["/users"]).toBeDefined();
    expect(routes["/users/[id]"]).toBeDefined();
  });

  test("GET / returns 200 with correct body", async () => {
    const routes = await getRoutes({ routesDirectory: fixturesDir });
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
    const routes = await getRoutes({ routesDirectory: fixturesDir });
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
    const routes = await getRoutes({
      routesDirectory: fixturesDir,
      sessionGetter: async () => {
        sessionGetterCalled = true;
        return { user: { id: 1 } };
      },
    });
    const handler = getHandler(routes["/"]);
    if (typeof handler !== "function") {
      throw new Error("Expected function handler");
    }
    const req = new Request("http://localhost/");
    await handler(req, {} as any);
    expect(sessionGetterCalled).toBe(true);
  });

  test("applies routePrefix", async () => {
    const routes = await getRoutes({
      routesDirectory: fixturesDir,
      routePrefix: "/api",
    });
    // Root route becomes /api/ (prefix + /)
    expect(routes["/api/"]).toBeDefined();
    expect(routes["/api/users"]).toBeDefined();
    expect(routes["/api/users/[id]"]).toBeDefined();
  });

  test("preserves directory casing in route paths", async () => {
    const routes = await getRoutes({
      routesDirectory: fixturesDir,
    });

    expect(routes["/CamelCase"]).toBeDefined();
    expect(routes["/camelcase"]).toBeUndefined();
  });
});
