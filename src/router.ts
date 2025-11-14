import { pathToFileURL, type BunRequest, type Server } from "bun";
import path from "path";
import { Glob } from "bun";
import { ResponseError } from "./errors/ResponseError";
import { InternalServerError } from "./errors/GenericErrors";
import type { HandlerContext, AuthProvider } from "./types";

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

export interface RoutesConfig {
  routesDirectory: string;
  routePrefix?: string; // e.g., "/api"
  authProvider?: AuthProvider;
  logger?: {
    error: (message: string, meta?: any) => void;
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

export async function getRoutes(config: RoutesConfig): Promise<BunRoutesMap> {
  const { routesDirectory, routePrefix = "", authProvider, logger } = config;

  const discovered = await readRoutes(routesDirectory, routePrefix);
  if (discovered.length === 0) return {};

  return await parseRoutes(discovered, authProvider, logger);
}

async function parseRoutes(
  discovered: Discovered[],
  authProvider?: AuthProvider,
  logger?: RoutesConfig["logger"]
): Promise<BunRoutesMap> {
  const routes: Record<string, Record<string, Function>> = {};

  const imports = await Promise.all(
    discovered.map((d) => import(pathToFileURL(d.handler).toString()))
  );

  for (let i = 0; i < discovered.length; i++) {
    const d = discovered[i]!;
    const mod = imports[i] as {
      default: {
        new (req: BunRequest, ctx: HandlerContext<boolean>): {
          invoke(): Promise<Response>;
        };
      };
    };

    const Ctor = mod.default;

    if (typeof Ctor !== "function") {
      throw new Error(
        `Route controller ${d.path}/${d.method} must default export a class.`
      );
    }

    const key = d.path; // already prefixed
    const method = d.method.toUpperCase() as Uppercase<Method>;

    const handler = async (request: Request, _server: Server<any>) => {
      try {
        const bunReq = request as BunRequest;

        // If you have a params extractor, attach here:
        // (bunReq as any).params = extractParamsSomehow(request.url, key);

        const session = authProvider
          ? await authProvider.getSession(request.headers)
          : undefined;

        const context: HandlerContext<boolean> = { session };

        const instance = new Ctor(bunReq, context);
        return await instance.invoke();
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

async function readRoutes(
  dir: string,
  routePrefix: string
): Promise<Discovered[]> {
  const glob = new Glob("**/*.{ts,js}");
  const handlers: Discovered[] = [];

  for await (const file of glob.scan(dir)) {
    const name = path.basename(file);
    const method = name.slice(0, -3).toLowerCase();
    if (!methodSet.has(method as Method)) continue;

    const dirPath = path.dirname(file);
    const relative =
      dirPath === "."
        ? "/"
        : "/" + dirPath.split(path.sep).join("/").toLowerCase();
    const routePath = (routePrefix + relative).replace(/\/{2,}/g, "/");

    handlers.push({
      path: routePath,
      handler: path.join(dir, file),
      method: method as Method,
    });
  }

  return handlers;
}
