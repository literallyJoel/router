# Router Example

Minimal Bun setup showing the recommended `createRouter` pattern.

```sh
bun install
bun run dev
```

The important bit is `src/router.ts`: it creates the router once, exports the bound `getRoutes` and `createController`, and every route imports `createController` from there. That lets controller session types be inferred from `sessionGetter`.
