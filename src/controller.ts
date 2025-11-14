import type { BunRequest } from "bun";
import type { HandlerContext, AuthProvider, StandardSchemaV1 } from "./types";
import { ResponseError } from "./errors/ResponseError";
import type { FieldError } from "./errors/ResponseError";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./errors/GenericErrors";
import { parseStandardSchema, validateUUID } from "./validation";

type RouteControllerProps<
  TAuth extends boolean = boolean,
  TData = unknown,
  TUUIDKeys extends string[] | undefined = string[] | undefined
> = {
  request: BunRequest & { params?: Record<string, string | undefined> };
  ctx: HandlerContext<TAuth>;
  requiresAuthentication: TAuth;
  inputSchema?: StandardSchemaV1<any, TData>;
  validateUUIDs?: TUUIDKeys;
  authProvider?: AuthProvider;
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

export abstract class BaseController<
  TAuth extends boolean = boolean,
  TData = unknown,
  TUUIDKey extends string[] | undefined = string[] | undefined
> {
  public readonly request: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey
  >["request"];
  public readonly ctx: RouteControllerProps<TAuth, TData, TUUIDKey>["ctx"];
  public readonly requiresAuthentication: TAuth;
  public readonly inputSchema?: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey
  >["inputSchema"];
  public readonly validateUUIDs?: RouteControllerProps<
    TAuth,
    TData,
    TUUIDKey
  >["validateUUIDs"];
  public readonly authProvider?: AuthProvider;

  public json!: TData extends undefined ? undefined : TData;
  public session!: Session<TAuth>;
  public params!: ValidatedUUIDs<TUUIDKey>;

  get user(): User<TAuth> {
    return this.session?.user as User<TAuth>;
  }

  protected responseError?: ResponseError;

  protected constructor(args: RouteControllerProps<TAuth, TData, TUUIDKey>) {
    const {
      request,
      ctx,
      requiresAuthentication,
      inputSchema,
      validateUUIDs,
      authProvider,
    } = args;

    this.request = request;
    this.ctx = ctx;
    this.requiresAuthentication = requiresAuthentication;
    this.inputSchema = inputSchema;
    this.validateUUIDs = validateUUIDs;
    this.authProvider = authProvider;
  }

  async invoke(): Promise<Response> {
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
        this.inputSchema
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

  private async _checkAuthStatus(): Promise<this> {
    if (!this.authProvider) {
      if (this.requiresAuthentication) {
        this.responseError = new UnauthorizedError({
          message: "Authentication provider not configured",
        });
      }
      return this;
    }

    const session = await this.authProvider.getSession(this.request.headers);

    if (this.requiresAuthentication && !session) {
      this.responseError = new UnauthorizedError({
        message: "You must be logged in to view this content",
      });
      return this;
    }

    this.ctx.session = session;
    this.session = session as Session<TAuth>;

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

      const valid = validateUUID(raw);

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
    validated: Readonly<TData>
  ): Promise<FieldError[]> | FieldError[] {
    return [];
  }
}

type ControllerConfig<
  TAuth extends boolean,
  TData,
  TUUIDKeys extends string[] | undefined = string[] | undefined
> = {
  validationSchema?: StandardSchemaV1<any, TData>;
  validateUUIDs?: TUUIDKeys;
  requiresAuthentication: TAuth;
  authProvider?: AuthProvider;
};

export function createController<
  TAuth extends boolean,
  TData = unknown,
  TUUIDKeys extends string[] | undefined = undefined
>(
  handler: (
    controller: BaseController<TAuth, TData, TUUIDKeys>
  ) => Promise<Response>,
  config: ControllerConfig<TAuth, TData, TUUIDKeys>,
  additionalValidator?: (validated: TData) => FieldError[]
): {
  new (request: BunRequest, ctx: HandlerContext<TAuth>): BaseController<
    TAuth,
    TData,
    TUUIDKeys
  >;
} {
  return class extends BaseController<TAuth, TData, TUUIDKeys> {
    constructor(request: BunRequest, ctx: HandlerContext<TAuth>) {
      super({
        request,
        ctx,
        requiresAuthentication: config.requiresAuthentication,
        inputSchema: config.validationSchema,
        validateUUIDs: config.validateUUIDs,
        authProvider: config.authProvider,
      });
    }

    async run(): Promise<Response> {
      return handler(this);
    }

    protected override async additionalValidation(
      validated: Readonly<TData>
    ): Promise<FieldError[]> {
      return additionalValidator?.(validated as TData) ?? [];
    }
  };
}
