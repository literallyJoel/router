# Router Example

Minimal Bun setup showing the recommended `createRouter` pattern.

```sh
bun install
bun run dev
```

The important bit is `src/router.ts`: it creates the router once, exports the bound `getRoutes` and `createController`, and every route imports `createController` from there. That lets controller session types be inferred from `sessionGetter`.

This example maps `@literallyjoel/router` to the local `../src/index.ts` in `tsconfig.json`, so type-checking reflects the source tree while developing this package.
