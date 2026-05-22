import type { BunRequest } from "bun";
import type { HandlerContext, StandardSchemaV1, TSession } from "./types";
import { ResponseError } from "./errors/ResponseError";
import type { FieldError } from "./errors/ResponseError";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./errors/GenericErrors";
import {
  parseStandardSchema,
  validateUUID,
  type UUIDVersion,
} from "./validation";

type RouteControllerProps<
  TAuth extends boolean = boolean,
  TData = unknown,
  TUUIDKeys extends string[] | undefined = string[] | undefined,
  TQuery = undefined,
  TResolvedSession = TSession,
> = {
  request: BunRequest & { params?: Record<string, string | undefined> };
  ctx: HandlerContext<TAuth, TResolvedSession>;
  requiresAuthentication: TAuth;
  inputSchema?: StandardSchemaV1<any, TData>;
  querySchema?: StandardSchemaV1<any, TQuery>;
  validateUUIDs?: TUUIDKeys;
  uuidVersion?: UUIDVersion;
};

type Session<TAuth extends boolean, TResolvedSession> = TAuth extends true
  ? NonNullable<TResolvedSession>
  : TResolvedSession | undefined;

type User<TAuth extends boolean, TResolvedSession> =
  NonNullable<Session<TAuth, TResolvedSession>> extends { user?: infer TUser }
    ? TAuth extends true
      ? NonNullable<TUser>
      : TUser | undefined
    : TAuth extends true
      ? never
      : undefined;

type ValidatedUUIDs<T extends readonly string[] | undefined> =
  T extends readonly string[]
    ? { [K in T[number]]: string } & {
        [K in Exclude<string, T[number]>]?: string | undefined;
      }
    : Record<string, string | undefined>;

/** Raw query parameter value before schema parsing/coercion. */
export type RawQueryValue = string | string[] | undefined;
/**
 * Raw query object preserving repeated keys as arrays.
 *
 * @example
 * `?page=1&tag=bun&tag=router` becomes:
 * `{ page: "1", tag: ["bun", "router"] }`
 */
export type RawQuery = Record<string, RawQueryValue>;

/**
 * Base controller lifecycle and validated request data accessors.
 * `createController` returns concrete subclasses of this class.
 *
 * @example
 * ```ts
 * export default createController(
 *   async (ctrl) => {
 *     return Response.json({
 *       body: ctrl.json,
 *       query: ctrl.query,
 *       userId: ctrl.user?.id,
 *     });
 *   },
 *   { requiresAuthentication: false },
 * );
 * ```
 */
export abstract class BaseController<
  TAuth extends boolean = boolean,
  TData = unknown,
  TUUIDKey extends string[] | undefined = string[] | undefined,
  TQuery = undefined,
  TResolvedSession = TSession,
> {
  /** Original Bun request object. */
  public readonly request: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey,
    TQuery,
    TResolvedSession
  >["request"];
  /** Runtime context passed to the controller, including session information. */
  public readonly ctx: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey,
    TQuery,
    TResolvedSession
  >["ctx"];
  /** Whether this controller requires an authenticated session. */
  public readonly requiresAuthentication: TAuth;
  /** Optional Standard Schema used to validate `request.json()`. */
  public readonly inputSchema?: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey,
    TQuery,
    TResolvedSession
  >["inputSchema"];
  /** Optional Standard Schema used to validate parsed query parameters. */
  public readonly querySchema?: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey,
    TQuery,
    TResolvedSession
  >["querySchema"];
  /** Optional list of route param keys that must be valid UUIDs. */
  public readonly validateUUIDs?: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey,
    TQuery,
    TResolvedSession
  >["validateUUIDs"];
  /** Optional UUID version constraint for validated UUID params. */
  public readonly uuidVersion?: UUIDVersion;
  /** Native URL query API for low-level access to query params. */
  public readonly searchParams: URLSearchParams;
  /** Validated request body (when `validationSchema` is configured). */
  public json!: TData extends undefined ? undefined : TData;
  /**
   * Parsed query params.
   * - Without `querySchema`: raw `RawQuery`.
   * - With `querySchema`: validated/coerced `TQuery`.
   */
  public query!: TQuery extends undefined ? RawQuery : TQuery;
  /** Resolved session for this request. */
  public session!: Session<TAuth, TResolvedSession>;
  /** Validated UUID params configured by `validateUUIDs`. */
  public params!: ValidatedUUIDs<TUUIDKey>;

  /** Convenience accessor for `session.user` with auth-aware typing. */
  get user(): User<TAuth, TResolvedSession> {
    return (this.session as { user?: unknown } | undefined)?.user as User<
      TAuth,
      TResolvedSession
    >;
  }

  protected responseError?: ResponseError;

  protected constructor(
    args: RouteControllerProps<
      TAuth,
      TData,
      TUUIDKey,
      TQuery,
      TResolvedSession
    >,
  ) {
    const {
      request,
      ctx,
      requiresAuthentication,
      inputSchema,
      querySchema,
      validateUUIDs,
      uuidVersion,
    } = args;

    this.request = request;
    this.ctx = ctx;
    this.requiresAuthentication = requiresAuthentication;
    this.inputSchema = inputSchema;
    this.querySchema = querySchema;
    this.validateUUIDs = validateUUIDs;
    this.uuidVersion = uuidVersion;
    this.searchParams = new URL(request.url).searchParams;
  }

  /**
   * Runs controller initialization (auth + validation) and returns a response.
   *
   * @param session Optional session override. If omitted, uses `ctx.session`.
   */
  async invoke(session?: TResolvedSession): Promise<Response> {
    const resolvedSession = (session ?? this.ctx.session) as TResolvedSession;
    this.session = resolvedSession as Session<TAuth, TResolvedSession>;
    (this.ctx as HandlerContext<boolean, TResolvedSession>).session =
      resolvedSession;
    return (await this.init()).respond();
  }

  /** Sets a response error and returns its serialized response. */
  protected failWith(error: ResponseError): Response {
    this.responseError = error;
    return error.toResponse();
  }

  /** Executes `run()` unless initialization produced an early error response. */
  private async respond(): Promise<Response> {
    if (this.responseError) return this.responseError.toResponse();
    const resp = await this.run();
    if (this.responseError) {
      return (this.responseError as ResponseError).toResponse();
    }
    return resp;
  }

  /** Controller initialization pipeline executed before `run()`. */
  private async init(): Promise<this> {
    await this._validateUUIDs();
    await this._checkAuthStatus();
    await this._validateQueryInput();
    await this._validateJSONInput();
    await this._additionalValidation();
    return this;
  }

  /** Runs caller-provided post-schema validation and merges field errors. */
  private async _additionalValidation(): Promise<this> {
    if (this.json === undefined) return this;

    const baseFieldErrors = this.responseError?.fieldErrors ?? [];
    const additionalErrors = await this.additionalValidation(this.json);
    const fieldErrors =
      additionalErrors && additionalErrors.length > 0
        ? [...baseFieldErrors, ...additionalErrors]
        : baseFieldErrors;

    if (fieldErrors.length > 0) {
      const responseError = this.responseError ?? new ValidationError();
      responseError.fieldErrors = fieldErrors;
      this.responseError = responseError;
    }

    return this;
  }

  /** Parses + validates JSON body using `inputSchema` when configured. */
  private async _validateJSONInput(): Promise<this> {
    if (!this.inputSchema || this.responseError) return this;

    let jsonUnsafe: unknown;
    try {
      jsonUnsafe = await this.request.json();
    } catch {
      this.responseError = new ValidationError({
        message: "Invalid JSON body provided",
      });
      return this;
    }

    try {
      const out = await parseStandardSchema<TData>(
        jsonUnsafe,
        this.inputSchema,
      );
      this.json = out as TData extends undefined ? undefined : TData;
    } catch (err) {
      if (err instanceof ResponseError) {
        this.responseError = err;
      } else {
        this.responseError = new ValidationError({
          message: "Invalid input",
        });
      }
    }

    return this;
  }

  /** Parses + validates query params using `querySchema` when configured. */
  private async _validateQueryInput(): Promise<this> {
    if (this.responseError) return this;

    const queryUnsafe = BaseController.toRawQuery(this.searchParams);

    if (!this.querySchema) {
      this.query = queryUnsafe as TQuery extends undefined ? RawQuery : TQuery;
      return this;
    }

    try {
      const out = await parseStandardSchema<TQuery>(queryUnsafe, this.querySchema);
      this.query = out as TQuery extends undefined ? RawQuery : TQuery;
    } catch (err) {
      if (err instanceof ResponseError) {
        this.responseError = err;
      } else {
        this.responseError = new ValidationError({
          message: "Invalid query parameters",
        });
      }
    }

    return this;
  }

  /** Converts `URLSearchParams` into the public `RawQuery` shape. */
  private static toRawQuery(searchParams: URLSearchParams): RawQuery {
    const query: RawQuery = {};

    for (const [key, value] of searchParams) {
      const existing = query[key];

      if (existing === undefined) {
        query[key] = value;
        continue;
      }

      if (Array.isArray(existing)) {
        existing.push(value);
        continue;
      }

      query[key] = [existing, value];
    }

    return query;
  }

  /** Enforces authentication for controllers requiring a session. */
  private async _checkAuthStatus(): Promise<this> {
    if (this.responseError) return this;

    if (this.requiresAuthentication && !this.session) {
      this.responseError = new UnauthorizedError({
        message: "You must be logged in to view this content",
      });
      return this;
    }

    return this;
  }

  /** Validates configured UUID route params and stores typed `params`. */
  private async _validateUUIDs(): Promise<this> {
    if (!this.validateUUIDs) {
      this.params = {} as ValidatedUUIDs<TUUIDKey>;
      return this;
    }

    const keys = this.validateUUIDs;
    const params = this.request.params;

    if (!params) {
      this.params = {} as ValidatedUUIDs<TUUIDKey>;
      return this;
    }

    const validatedParams: Record<string, string> = {};

    for (const key of keys) {
      const raw = params[key];
      if (!raw) {
        this.responseError = new NotFoundError();
        this.params = {} as ValidatedUUIDs<TUUIDKey>;
        return this;
      }

      const valid = validateUUID(raw, this.uuidVersion);

      if (!valid) {
        this.responseError = new NotFoundError();
        this.params = {} as ValidatedUUIDs<TUUIDKey>;
        return this;
      } else {
        validatedParams[key] = raw;
      }
    }

    this.params = validatedParams as ValidatedUUIDs<TUUIDKey>;
    return this;
  }

  /**
   * Subclass hook that must return a response for successful requests.
   * Implemented by the class generated by `createController`.
   */
  abstract run(): Promise<Response>;

  /** Optional subclass hook for additional semantic validation. */
  protected additionalValidation(
    validated: Readonly<TData>,
  ): Promise<FieldError[]> | FieldError[] {
    return [];
  }
}

export type ControllerConfig<
  TAuth extends boolean,
  TData,
  TUUIDKeys extends string[] | undefined = string[] | undefined,
  TQuery = undefined,
> = {
  /** Standard Schema V1 schema used to validate and type `controller.json`. */
  validationSchema?: StandardSchemaV1<any, TData>;
  /** Standard Schema V1 schema used to validate and type `controller.query`. */
  querySchema?: StandardSchemaV1<any, TQuery>;
  /** Route param keys that should be validated as UUIDs before handler runs. */
  validateUUIDs?: TUUIDKeys;
  /** Whether a session is required. Missing session yields `401 Unauthorized`. */
  requiresAuthentication: TAuth;
  /** Optional UUID version used when validating configured UUID params. */
  uuidVersion?: UUIDVersion;
};

/**
 * Factory for route controller classes with strongly-typed request data.
 * Supports body/query schema validation, UUID param checks, and auth flags.
 *
 * @param handler Async function that receives a typed controller instance and returns a `Response`.
 * @param config Validation/auth config for the controller.
 * @param additionalValidator Optional post-schema validation hook for cross-field checks.
 *
 * @example
 * ```ts
 * import { createController } from "@literallyjoel/router";
 * import { z } from "zod";
 *
 * const Body = z.object({ name: z.string().min(1) });
 * const Query = z.object({ page: z.coerce.number().int().min(1).default(1) });
 *
 * export default createController(
 *   async (ctrl) => {
 *     return Response.json({
 *       name: ctrl.json.name,  // typed from Body
 *       page: ctrl.query.page, // typed from Query
 *     });
 *   },
 *   {
 *     requiresAuthentication: false,
 *     validationSchema: Body,
 *     querySchema: Query,
 *   },
 *   (validated) => (validated.name === "admin"
 *     ? [{ field: "name", message: "Reserved name" }]
 *     : []),
 * );
 * ```
 */
export function createController<
  TAuth extends boolean,
  TData = unknown,
  TUUIDKeys extends string[] | undefined = undefined,
  TQuery = undefined,
  TResolvedSession = TSession,
>(
  handler: (
    controller: BaseController<TAuth, TData, TUUIDKeys, TQuery, TResolvedSession>,
  ) => Promise<Response>,
  config: ControllerConfig<TAuth, TData, TUUIDKeys, TQuery>,
  additionalValidator?: (
    validated: TData,
  ) => FieldError[] | Promise<FieldError[]>,
): {
  new (
    request: BunRequest,
    ctx: HandlerContext<TAuth, TResolvedSession>,
    uuidVersion?: UUIDVersion,
  ): BaseController<TAuth, TData, TUUIDKeys, TQuery, TResolvedSession>;
} {
  return class extends BaseController<
    TAuth,
    TData,
    TUUIDKeys,
    TQuery,
    TResolvedSession
  > {
    constructor(
      request: BunRequest,
      ctx: HandlerContext<TAuth, TResolvedSession>,
      uuidVersion?: UUIDVersion,
    ) {
      super({
        request,
        ctx,
        requiresAuthentication: config.requiresAuthentication,
        inputSchema: config.validationSchema,
        querySchema: config.querySchema,
        validateUUIDs: config.validateUUIDs,
        uuidVersion: config.uuidVersion ?? uuidVersion,
      });
    }

    /** Delegates request handling to the provided controller function. */
    async run(): Promise<Response> {
      return handler(this);
    }

    /** Forwards validated data to the optional additional validator hook. */
    protected override async additionalValidation(
      validated: Readonly<TData>,
    ): Promise<FieldError[]> {
      const result = additionalValidator?.(validated as TData);
      return result !== undefined ? await result : [];
    }
  };
}


export type ControllerFactory<TResolvedSession = TSession> = <
  TAuth extends boolean,
  TData = unknown,
  TUUIDKeys extends string[] | undefined = undefined,
  TQuery = undefined,
>(
  handler: (
    controller: BaseController<TAuth, TData, TUUIDKeys, TQuery, TResolvedSession>,
  ) => Promise<Response>,
  config: ControllerConfig<TAuth, TData, TUUIDKeys, TQuery>,
  additionalValidator?: (
    validated: TData,
  ) => FieldError[] | Promise<FieldError[]>,
) => {
  new (
    request: BunRequest,
    ctx: HandlerContext<TAuth, TResolvedSession>,
    uuidVersion?: UUIDVersion,
  ): BaseController<TAuth, TData, TUUIDKeys, TQuery, TResolvedSession>;
};

export function createControllerForSession<
  TResolvedSession = TSession,
>(): ControllerFactory<TResolvedSession> {
  return createController as ControllerFactory<TResolvedSession>;
}
