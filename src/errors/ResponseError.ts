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
    this.responseCode = responseCode;
    this.data = data;
    this.fieldErrors = fieldErrors;
    this.internalError = internalError;
  }

  toResponse() {
    const _response: Record<string, string> = {};
    _response.message = this.message;
    if (this.data) _response.data = JSON.stringify(this.data);
    if (this.fieldErrors) _response.fields = JSON.stringify(this.fieldErrors);

    return Response.json(_response, { status: this.responseCode });
  }
}
