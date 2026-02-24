import { ResponseError, type ResponseErrorConfig } from "./ResponseError";

/**
 * 404 error class with `Not Found` defaults.
 *
 * @example
 * ```ts
 * throw new NotFoundError({ message: "User not found" });
 * ```
 */
export const NotFoundError = makeErrorClass("NotFoundError", {
  message: "Not Found",
  responseCode: 404,
});

/** 409 error class with `Conflict` defaults. */
export const ConflictError = makeErrorClass("ConflictError", {
  message: "Conflict",
  responseCode: 409,
});

/** 500 error class with `Internal Server Error` defaults. */
export const InternalServerError = makeErrorClass("InternalServerError", {
  message: "Internal Server Error",
  responseCode: 500,
});

/** 401 error class with `Unauthorized` defaults. */
export const UnauthorizedError = makeErrorClass("UnauthorizedError", {
  message: "Unauthorized",
  responseCode: 401,
});

/** 403 error class with `Forbidden` defaults. */
export const ForbiddenError = makeErrorClass("ForbiddenError", {
  message: "Forbidden",
  responseCode: 403,
});

/** 400 error class with `Bad Request` defaults. */
export const ValidationError = makeErrorClass("ValidationError", {
  message: "Bad Request",
  responseCode: 400,
});

/** Creates typed `ResponseError` subclasses with default config. */
function makeErrorClass<TName extends string>(
  name: TName,
  defaults: Omit<ResponseErrorConfig, "internalError" | "fieldErrors">,
) {
  return class extends ResponseError {
    /** Builds an instance, allowing defaults to be overridden per throw site. */
    constructor(overrides?: Partial<ResponseErrorConfig>) {
      super({
        message: overrides?.message ?? defaults.message,
        responseCode: overrides?.responseCode ?? defaults.responseCode,
        data: overrides?.data ?? defaults.data,
        fieldErrors: overrides?.fieldErrors,
        internalError: overrides?.internalError,
      });

      Object.defineProperty(this, "name", { value: name, configurable: true });
    }
  };
}
