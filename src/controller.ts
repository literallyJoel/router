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
> = {
  request: BunRequest & { params?: Record<string, string | undefined> };
  ctx: HandlerContext<TAuth>;
  requiresAuthentication: TAuth;
  inputSchema?: StandardSchemaV1<any, TData>;
  querySchema?: StandardSchemaV1<any, TQuery>;
  validateUUIDs?: TUUIDKeys;
  uuidVersion?: UUIDVersion;
};

type Session<TAuth extends boolean> = TAuth extends true
  ? NonNullable<any>
  : any | undefined;

type User<TAuth extends boolean> = TAuth extends true
  ? NonNullable<any>
  : any | undefined;

type ValidatedUUIDs<T extends readonly string[] | undefined> =
  T extends readonly string[]
    ? { [K in T[number]]: string } & {
        [K in Exclude<string, T[number]>]?: string | undefined;
      }
    : Record<string, string | undefined>;

export type RawQueryValue = string | string[] | undefined;
export type RawQuery = Record<string, RawQueryValue>;

export abstract class BaseController<
  TAuth extends boolean = boolean,
  TData = unknown,
  TUUIDKey extends string[] | undefined = string[] | undefined,
  TQuery = undefined,
> {
  public readonly request: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey,
    TQuery
  >["request"];
  public readonly ctx: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey,
    TQuery
  >["ctx"];
  public readonly requiresAuthentication: TAuth;
  public readonly inputSchema?: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey,
    TQuery
  >["inputSchema"];
  public readonly querySchema?: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey,
    TQuery
  >["querySchema"];
  public readonly validateUUIDs?: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey,
    TQuery
  >["validateUUIDs"];
  public readonly uuidVersion?: UUIDVersion;
  public readonly searchParams: URLSearchParams;
  public json!: TData extends undefined ? undefined : TData;
  public query!: TQuery extends undefined ? RawQuery : TQuery;
  public session!: Session<TAuth>;
  public params!: ValidatedUUIDs<TUUIDKey>;

  get user(): User<TAuth> {
    return this.session?.user as User<TAuth>;
  }

  protected responseError?: ResponseError;

  protected constructor(
    args: RouteControllerProps<TAuth, TData, TUUIDKey, TQuery>,
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

  async invoke(session?: TSession): Promise<Response> {
    const resolvedSession = (session ?? this.ctx.session) as TSession;
    this.session = resolvedSession;
    this.ctx.session = resolvedSession;
    return (await this.init()).respond();
  }

  protected failWith(error: ResponseError): Response {
    this.responseError = error;
    return error.toResponse();
  }

  private async respond(): Promise<Response> {
    if (this.responseError) return this.responseError.toResponse();
    const resp = await this.run();
    if (this.responseError) {
      return (this.responseError as ResponseError).toResponse();
    }
    return resp;
  }

  private async init(): Promise<this> {
    await this._validateUUIDs();
    await this._checkAuthStatus();
    await this._validateQueryInput();
    await this._validateJSONInput();
    await this._additionalValidation();
    return this;
  }

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

  private async _validateQueryInput(): Promise<this> {
    if (this.responseError) return this;

    const queryUnsafe = this.toRawQuery(this.searchParams);

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

  private toRawQuery(searchParams: URLSearchParams): RawQuery {
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

  abstract run(): Promise<Response>;

  protected additionalValidation(
    validated: Readonly<TData>,
  ): Promise<FieldError[]> | FieldError[] {
    return [];
  }
}

type ControllerConfig<
  TAuth extends boolean,
  TData,
  TUUIDKeys extends string[] | undefined = string[] | undefined,
  TQuery = undefined,
> = {
  validationSchema?: StandardSchemaV1<any, TData>;
  querySchema?: StandardSchemaV1<any, TQuery>;
  validateUUIDs?: TUUIDKeys;
  requiresAuthentication: TAuth;
  uuidVersion?: UUIDVersion;
};

export function createController<
  TAuth extends boolean,
  TData = unknown,
  TUUIDKeys extends string[] | undefined = undefined,
  TQuery = undefined,
>(
  handler: (
    controller: BaseController<TAuth, TData, TUUIDKeys, TQuery>,
  ) => Promise<Response>,
  config: ControllerConfig<TAuth, TData, TUUIDKeys, TQuery>,
  additionalValidator?: (
    validated: TData,
  ) => FieldError[] | Promise<FieldError[]>,
): {
  new (
    request: BunRequest,
    ctx: HandlerContext<TAuth>,
    uuidVersion?: UUIDVersion,
  ): BaseController<TAuth, TData, TUUIDKeys, TQuery>;
} {
  return class extends BaseController<TAuth, TData, TUUIDKeys, TQuery> {
    constructor(
      request: BunRequest,
      ctx: HandlerContext<TAuth>,
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

    async run(): Promise<Response> {
      return handler(this);
    }

    protected override async additionalValidation(
      validated: Readonly<TData>,
    ): Promise<FieldError[]> {
      const result = additionalValidator?.(validated as TData);
      return result !== undefined ? await result : [];
    }
  };
}
