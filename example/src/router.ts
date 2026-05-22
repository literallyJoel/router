export const { getRoutes, createController } = createRouter({
  routesDirectory: "./src/routes",
  routePrefix: "/api",
  sessionGetter: async (headers,) => {
    const token = headers.get("authorization");

    return token
      ? {
          user: {
            id: "user_123",
            role: "admin" as const,
          },
        }
      : null;
  },
});
