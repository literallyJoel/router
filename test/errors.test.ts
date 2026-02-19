import { describe, expect, test } from "bun:test";
import {
  ResponseError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  InternalServerError,
} from "../src/index";

describe("ResponseError", () => {
  test("creates error with message and status", () => {
    const err = new ResponseError({
      message: "Test error",
      responseCode: 400,
    });
    expect(err.message).toBe("Test error");
    expect(err.responseCode).toBe(400);
    expect(err.name).toBe("ResponseError");
  });

  test("toResponse returns JSON with correct status", async () => {
    const err = new ResponseError({
      message: "Bad request",
      responseCode: 400,
    });
    const res = err.toResponse();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ message: "Bad request" });
  });

  test("toResponse includes data when provided", async () => {
    const err = new ResponseError({
      message: "Error",
      responseCode: 422,
      data: { code: "INVALID_ID" },
    });
    const res = err.toResponse();
    const body = (await res.json()) as { data?: unknown };
    expect(body.data).toEqual({ code: "INVALID_ID" });
  });

  test("toResponse includes fields when fieldErrors provided", async () => {
    const err = new ResponseError({
      message: "Validation failed",
      responseCode: 400,
      fieldErrors: [
        { field: "email", message: "Invalid email" },
        { field: "name", message: "Required" },
      ],
    });
    const res = err.toResponse();
    const body = (await res.json()) as { fields?: unknown };
    expect(body.fields).toEqual([
      { field: "email", message: "Invalid email" },
      { field: "name", message: "Required" },
    ]);
  });

  test("instanceof works correctly", () => {
    const err = new ResponseError({
      message: "Test",
      responseCode: 500,
    });
    expect(err).toBeInstanceOf(ResponseError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("GenericErrors", () => {
  test("NotFoundError has correct defaults", async () => {
    const err = new NotFoundError();
    expect(err.message).toBe("Not Found");
    expect(err.responseCode).toBe(404);
    expect(err.name).toBe("NotFoundError");
    const res = err.toResponse();
    expect(res.status).toBe(404);
  });

  test("ValidationError has correct defaults", async () => {
    const err = new ValidationError();
    expect(err.message).toBe("Bad Request");
    expect(err.responseCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });

  test("UnauthorizedError has correct defaults", () => {
    const err = new UnauthorizedError();
    expect(err.message).toBe("Unauthorized");
    expect(err.responseCode).toBe(401);
  });

  test("ForbiddenError has correct defaults", () => {
    const err = new ForbiddenError();
    expect(err.message).toBe("Forbidden");
    expect(err.responseCode).toBe(403);
  });

  test("ConflictError has correct defaults", () => {
    const err = new ConflictError();
    expect(err.message).toBe("Conflict");
    expect(err.responseCode).toBe(409);
  });

  test("InternalServerError has correct defaults", () => {
    const err = new InternalServerError();
    expect(err.message).toBe("Internal Server Error");
    expect(err.responseCode).toBe(500);
  });

  test("errors accept overrides", () => {
    const err = new NotFoundError({ message: "User not found" });
    expect(err.message).toBe("User not found");
    expect(err.responseCode).toBe(404);
  });

  test("errors accept fieldErrors override", () => {
    const err = new ValidationError({
      fieldErrors: [{ field: "x", message: "Invalid" }],
    });
    const res = err.toResponse();
    expect(res.status).toBe(400);
    // Verify via toResponse
    expect(err.fieldErrors).toEqual([{ field: "x", message: "Invalid" }]);
  });
});
