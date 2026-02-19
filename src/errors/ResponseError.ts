export type FieldError = { field: string; message: string };

export type ResponseErrorConfig = {
  message: string;
  responseCode: number;
  data?: object;
  fieldErrors?: FieldError[];
  internalError?: Error;
};

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

  toResponse(): Response {
    const body: Record<string, unknown> = { message: this.message };
    if (this.data) body.data = this.data;
    if (this.fieldErrors) body.fields = this.fieldErrors;
    return Response.json(body, { status: this.responseCode });
  }
}
