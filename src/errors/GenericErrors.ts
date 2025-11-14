import { ResponseError, type ResponseErrorConfig } from "./ResponseError";

export const NotFoundError = makeErrorClass("NotFoundError", {
  message: "Not Found",
  responseCode: 404,
});

export const ConflictError = makeErrorClass("ConflictError", {
  message: "Conflict",
  responseCode: 409,
});

export const InternalServerError = makeErrorClass("InternalServerError", {
  message: "Internal Server Error",
  responseCode: 500,
});

export const UnauthorizedError = makeErrorClass("UnauthorizedError", {
  message: "Unauthorized",
  responseCode: 401,
});

export const ForbiddenError = makeErrorClass("ForbiddenError", {
  message: "Forbidden",
  responseCode: 403,
});

export const ValidationError = makeErrorClass("ValidationError", {
  message: "Bad Request",
  responseCode: 400,
});

function makeErrorClass<TName extends string>(
  name: TName,
  defaults: Omit<ResponseErrorConfig, "internalError" | "fieldErrors">
) {
  return class extends ResponseError {
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
