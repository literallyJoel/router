import { createRouter } from "../src/index";

// @ts-expect-error getRoutes must be accessed from createRouter().
import { getRoutes as directGetRoutes } from "../src/index";

// @ts-expect-error createController must be accessed from createRouter().
import { createController as directCreateController } from "../src/index";

const { createController } = createRouter({
  routesDirectory: "./test/fixtures/routes",
  sessionGetter: async (headers: Headers) => {
    const token = headers.get("authorization");
    return token
      ? { user: { id: "user_1", role: "admin" as const }, orgId: "org_1" }
      : null;
  },
});

createController(
  async (ctrl) => {
    const sessionId: string = ctrl.session.user.id;
    const ctxOrgId: string = ctrl.ctx.session.orgId;
    const role: "admin" = ctrl.user.role;

    return Response.json({ sessionId, ctxOrgId, role });
  },
  { requiresAuthentication: true },
);

createController(
  async (ctrl) => {
    const maybeId: string | undefined = ctrl.user?.id;
    const maybeSession:
      | { user: { id: string; role: "admin" }; orgId: string }
      | null
      | undefined = ctrl.session;

    return Response.json({ maybeId, hasSession: Boolean(maybeSession) });
  },
  { requiresAuthentication: false },
);
