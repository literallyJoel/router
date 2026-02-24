import type { BunRequest } from "bun";
import type { StandardSchemaV1 } from "@standard-schema/spec";

/** Generic session payload resolved for a request. */
export type TSession = any;

/**
 * Request context injected into route handlers/controllers.
 * When auth is required, `session` is guaranteed to be non-null.
 *
 * @example
 * `HandlerContext<true>` -> `{ session: NonNullable<TSession> }`
 */
export type HandlerContext<TAuth extends boolean = boolean> = TAuth extends true
  ? { session: NonNullable<TSession> }
  : { session?: TSession | undefined };

/**
 * Handler signature used by discovered routes.
 *
 * @example
 * ```ts
 * const handler: RouteHandler = async (req, ctx) => {
 *   return Response.json({ hasSession: Boolean(ctx.session) });
 * };
 * ```
 */
export type RouteHandler<TAuth extends boolean = boolean> = (
  req: BunRequest,
  ctx: HandlerContext<TAuth>,
) => Response | Promise<Response>;

/**
 * Resolves a session from request headers.
 *
 * @example
 * ```ts
 * const sessionGetter: SessionGetter = async (headers) => {
 *   const token = headers.get("authorization");
 *   return token ? { user: { id: "123" } } : undefined;
 * };
 * ```
 */
export type SessionGetter = (headers: Headers) => TSession | Promise<TSession>;

export type { StandardSchemaV1 };
