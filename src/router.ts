import { pathToFileURL, type BunRequest, type Server } from "bun";
import path from "path";
import { Glob } from "bun";
import { ResponseError } from "./errors/ResponseError";
import { InternalServerError } from "./errors/GenericErrors";
import { createControllerForSession } from "./controller";
import type {
  HandlerContext,
  InferSession,
  SessionGetter,
  TSession,
} from "./types";
import type { UUIDVersion } from "./validation";

const methods = [
  "get",
  "post",
  "patch",
  "put",
  "delete",
  "head",
  "options",
] as const;
const methodSet = new Set(methods);
type Method = (typeof methods)[number];

/**
 * Configuration for filesystem route discovery and route wiring.
 *
 * @example
 * ```ts
 * const { getRoutes } = createRouter({
 *   routesDirectory: "./src/routes",
 *   routePrefix: "/api",
 *   sessionGetter: async (headers) => {
 *     const token = headers.get("authorization");
 *     return token ? { user: { id: "u_123" } } : undefined;
 *   },
 *   logger: { error: (message, meta) => console.error(message, meta) },
 * });
 *
 * const routes = await getRoutes();
 * ```
 */
export interface RoutesConfig<TResolvedSession = TSession> {
  /** Root directory containing route controller files. */
  routesDirectory: string;
  /** Optional URL prefix prepended to all discovered route paths. */
  routePrefix?: string;
  /** Optional UUID version used by controllers that validate UUID params. */
  uuidVersion?: UUIDVersion;
  /** Optional session resolver used to populate controller context. */
  sessionGetter?: SessionGetter<TResolvedSession>;
  /** Optional logger for internal errors thrown while handling requests. */
  logger?: {
    error: (message: string, meta?: unknown) => void;
  };
}

type Discovered = {
  path: string;
  handler: string;
  method: Method;
};

type BunRoutesMap = Record<
  string,
  | Response
  | ((request: Request, server: Server<any>) => Response | Promise<Response>)
  | Partial<
      Record<
        Uppercase<Method>,
        (request: Request, server: Server<any>) => Response | Promise<Response>
      >
    >
>;

/**
 * Discovers filesystem controllers and returns a Bun `routes` map.
 * The resulting handlers instantiate controller classes per request.
 *
 * @param config Discovery and runtime handler options.
 * @returns A Bun-compatible route map ready for `serve({ routes: ... })`.
 *
 * @example
 * ```ts
 * import { serve } from "bun";
 * import { createRouter } from "@literallyjoel/router";
 *
 * const { getRoutes } = createRouter({ routesDirectory: "./src/routes" });
 * const routes = await getRoutes();
 *
 * serve({
 *   routes: {
 *     ...routes,
 *     "/*": new Response("Not Found", { status: 404 }),
 *   },
 * });
 * ```
 */
async function getRoutes<TResolvedSession = TSession>(
  config: RoutesConfig<TResolvedSession>,
): Promise<BunRoutesMap> {
  const {
    routesDirectory,
    routePrefix = "",
    sessionGetter,
    logger,
    uuidVersion,
  } = config;

  const discovered = await readRoutes(routesDirectory, routePrefix);
  if (discovered.length === 0) return {};

  return await parseRoutes(discovered, sessionGetter, logger, uuidVersion);
}

/** Dynamically imports controllers and builds request handlers per method/path. */
async function parseRoutes<TResolvedSession = TSession>(
  discovered: Discovered[],
  sessionGetter?: SessionGetter<TResolvedSession>,
  logger?: RoutesConfig<TResolvedSession>["logger"],
  uuidVersion?: UUIDVersion,
): Promise<BunRoutesMap> {
  const routes: Record<string, Record<string, Function>> = {};

  const imports = await Promise.all(
    discovered.map((d) => import(pathToFileURL(d.handler).toString())),
  );

  for (let i = 0; i < discovered.length; i++) {
    const d = discovered[i]!;
    const mod = imports[i] as {
      default: {
        new (
          req: BunRequest,
          ctx: HandlerContext<boolean, TResolvedSession>,
          uuidVersion?: UUIDVersion,
        ): {
          invoke(session?: TResolvedSession): Promise<Response>;
        };
      };
    };

    const Ctor = mod.default;

    if (typeof Ctor !== "function") {
      throw new Error(
        `Route controller ${d.path}/${d.method} must default export a class.`,
      );
    }

    const key = d.path;
    const method = d.method.toUpperCase() as Uppercase<Method>;

    const handler = async (request: Request, _server: Server<any>) => {
      try {
        const bunReq = request as BunRequest;
        const session = sessionGetter
          // You could just grab the headers from the bun request, but we
          // pass them through as the first arg anyway for backwards compatibility.
          ? await sessionGetter(bunReq.headers, bunReq)
          : undefined;

        const context: HandlerContext<boolean, TResolvedSession> = { session };

        const instance = new Ctor(bunReq, context, uuidVersion);
        return await instance.invoke(session);
      } catch (e) {
        if (e instanceof ResponseError) {
          if (e.internalError && logger) {
            logger.error(e.message, {
              internalError: e.internalError,
              url: request.url,
              method,
              path: key,
            });
          }
          return e.toResponse();
        }

        const error = e instanceof Error ? e : new Error(String(e));
        if (logger) {
          logger.error(error.message, {
            internalError: error,
            stack: error.stack,
            url: request.url,
            path: key,
          });
        }

        return new InternalServerError().toResponse();
      }
    };

    const route = routes[key] ?? {};
    if (route[method]) {
      throw new Error(`Router ${d.method} ${d.path} is redefined`);
    }
    route[method] = handler;
    routes[key] = route;
  }

  return routes as unknown as BunRoutesMap;
}


type CreateRouterConfig<TGetter extends SessionGetter | undefined> = Omit<
  RoutesConfig<InferSession<TGetter>>,
  "sessionGetter"
> & {
  sessionGetter?: TGetter;
};

/**
 * Binds router configuration and controller typing together.
 *
 * The returned `createController` infers its session type from `sessionGetter`,
 * so route files can import it from your local router module.
 */
export function createRouter<TGetter extends SessionGetter | undefined = undefined>(
  config: CreateRouterConfig<TGetter>,
) {
  type TResolvedSession = InferSession<TGetter>;

  return {
    getRoutes: (overrides?: Partial<RoutesConfig<TResolvedSession>>) =>
      getRoutes<TResolvedSession>({
        ...config,
        ...overrides,
        sessionGetter:
          overrides?.sessionGetter ??
          (config.sessionGetter as SessionGetter<TResolvedSession> | undefined),
      }),
    createController: createControllerForSession<TResolvedSession>(),
  };
}

/** Scans the routes directory and returns method/path/controller metadata. */
async function readRoutes(
  dir: string,
  routePrefix: string,
): Promise<Discovered[]> {
  const glob = new Glob("**/*.{ts,js}");
  const handlers: Discovered[] = [];

  for await (const file of glob.scan(dir)) {
    const name = path.basename(file);
    const method = name.slice(0, -3).toLowerCase();
    if (!methodSet.has(method as Method)) continue;

    const dirPath = path.dirname(file);
    const relative =
      dirPath === "." ? "/" : "/" + dirPath.split(path.sep).join("/");
    const routePath = (routePrefix + relative).replace(/\/{2,}/g, "/");

    handlers.push({
      path: routePath,
      handler: path.join(dir, file),
      method: method as Method,
    });
  }

  return handlers;
}
