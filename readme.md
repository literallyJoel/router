# @literallyjoel/router

A minimal, type-safe routing + controller framework for Bun with:
- File-system route discovery (`get.ts`, `post.ts`, …)
- Class-based controllers
- Standard Schema V1 validation (use Zod, Valibot, ArkType, Yup, Joi, etc.)
- UUID parameter validation
- Optional authentication provider
- Friendly JSON error responses

Standard Schema spec: https://standardschema.dev

## Installation

```bash
bun add @literallyjoel/router
# or
npm install @literallyjoel/router
```

If you plan to pass schemas, install a schema library of your choice:
- Zod, Valibot, ArkType, Yup, Joi, Effect Schema, etc. Recent versions implement Standard Schema V1.

## Quick Start

### Folder structure

```
src/
  routes/
    users/
      get.ts      → GET /users
      post.ts     → POST /users
    users/[id]/
      get.ts      → GET /users/:id
```

### Example controller (Zod)

```ts
// src/routes/users/post.ts
import { createController } from "@literallyjoel/router";
import { z } from "zod";

const Schema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
});

export default createController(
  async (ctrl) => {
    // ctrl.json is typed and validated
    return Response.json({ user: ctrl.json });
  },
  {
    validationSchema: Schema, // Standard Schema via zod's implementation
    requiresAuthentication: false,
  },
  () => []
);
```

### Example controller (Valibot)

```ts
import { createController } from "@literallyjoel/router";
import * as v from "valibot";

const Schema = v.object({
  username: v.string([v.minLength(3)]),
  email: v.string([v.email()]),
});

export default createController(
  async (ctrl) => Response.json({ user: ctrl.json }),
  { validationSchema: Schema, requiresAuthentication: false },
  () => []
);
```

### Example controller (ArkType)

```ts
import { createController } from "@literallyjoel/router";
import { type } from "arktype";

const Schema = type({ username: "string.min(3)", email: "string.email" });

export default createController(
  async (ctrl) => Response.json({ user: ctrl.json }),
  { validationSchema: Schema, requiresAuthentication: false },
  () => []
);
```

### Boot the router

```ts
// src/server.ts
import { createRouter } from "@literallyjoel/router";
import { serve } from "bun";

const router = await createRouter({
  routesDirectory: "./src/routes",
  authProvider: {
    getSession: async (headers) => {
      const token = headers.get("authorization");
      return token ? { user: { id: "123" } } : null;
    },
  },
  logger: {
    error: (message, meta) => console.error(message, meta),
  },
});

serve({
  fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.toLowerCase();
    const route = router[path];

    if (!route) {
      return Response.json({ message: "Not Found" }, { status: 404 });
    }

    const method = req.method.toUpperCase();
    const handler = route[method as keyof typeof route];

    if (!handler) {
      return Response.json({ message: "Method Not Allowed" }, { status: 405 });
    }

    return handler(req, { session: undefined });
  },
});
```

## Standard Schema Validation

This library accepts any validator that implements Standard Schema V1:

- The schema must have a `~standard` property with `{ version: 1, vendor, validate }`.
- `validate(value)` returns `{ value }` on success or `{ issues }` on failure (sync or async).
- We convert `issues` into your controller’s `ValidationError` with `fieldErrors`.

Most popular libraries already implement this. You can also add a small wrapper that provides `~standard.validate()` if you prefer.

### Typed access to validated input

`ctrl.json` is set to the parsed schema’s output type on success. If validation fails, a 400 JSON response is returned automatically:
```json
{
  "message": "Bad Request",
  "fields": [
    { "field": "email", "message": "Invalid email" }
  ]
}
```

## UUID Params

Controllers can ask for automatic UUID validation of selected path params:

```ts
export default createController(
  async (ctrl) => Response.json({ id: ctrl.params.userId }),
  {
    requiresAuthentication: false,
    validateUUIDs: ["userId"],
  },
  () => []
);
```

Note: Your server must populate `req.params` for dynamic segments (e.g., via your routing layer).

## Authentication

Provide an `authProvider` to enable sessions:

```ts
export type AuthProvider = {
  getSession: (headers: Headers) => Promise<any | null>;
};
```

If `requiresAuthentication: true` and `getSession` returns `null`, the framework returns 401 automatically.

## Error Classes

Built-in, response-ready errors:

- ValidationError (400)
- UnauthorizedError (401)
- ForbiddenError (403)
- NotFoundError (404)
- ConflictError (409)
- InternalServerError (500)

Usage:
```ts
throw new NotFoundError({ message: "User not found" });
```

## Publishing

```bash
bun build ./src --outdir ./dist
npm publish --access public
```

Ensure package.json has:
```json
{
  "type": "module",
  "main": "./dist/index.js",
  "exports": { ".": "./dist/index.js" }
}
```

## Notes

- This package uses Standard Schema V1 at runtime only for the `validate` call and maps `issues` to a consistent error shape.
- No coupling to any specific validation library.
- Synchronous validation is preferred, but async is supported per the spec.