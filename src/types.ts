import type { BunRequest } from "bun";
import type { StandardSchemaV1 } from "@standard-schema/spec";

export type TSession = any;

export type HandlerContext<TAuth extends boolean = boolean> = TAuth extends true
  ? { session: NonNullable<TSession> }
  : { session?: TSession | undefined };

export type RouteHandler<TAuth extends boolean = boolean> = (
  req: BunRequest,
  ctx: HandlerContext<TAuth>
) => Response | Promise<Response>;

export type AuthProvider = {
  getSession: ({ headers }: { headers: Headers }) => Promise<TSession | null>;
};

export type { StandardSchemaV1 };
