/** Field-level validation issue in a normalized shape. */
export type FieldError = { field: string; message: string };

/** Options used to construct a `ResponseError`. */
export type ResponseErrorConfig = {
  message: string;
  responseCode: number;
  data?: object;
  fieldErrors?: FieldError[];
  internalError?: Error;
};

/**
 * Base application error that can be serialized to a JSON HTTP response.
 * Subclasses are expected to provide sensible defaults for status/message.
 *
 * @example
 * ```ts
 * throw new ResponseError({
 *   message: "Upstream timeout",
 *   responseCode: 504,
 *   internalError: new Error("gateway timeout"),
 * });
 * ```
 */
export class ResponseError extends Error {
  responseCode: number;
  data?: object;
  fieldErrors?: FieldError[];
  internalError?: Error;

  constructor({
    message,
    responseCode,
    data,
    fieldErrors,
    internalError,
  }: ResponseErrorConfig) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "ResponseError";
    this.responseCode = responseCode;
    this.data = data;
    this.fieldErrors = fieldErrors;
    this.internalError = internalError;
  }

  /**
   * Converts this error into a `Response` with a normalized JSON body.
   * Output shape:
   * - `{ message }`
   * - `{ message, data }` when `data` is present
   * - `{ message, fields }` when `fieldErrors` are present
   */
  toResponse(): Response {
    const body: Record<string, unknown> = { message: this.message };
    if (this.data) body.data = this.data;
    if (this.fieldErrors) body.fields = this.fieldErrors;
    return Response.json(body, { status: this.responseCode });
  }
}
