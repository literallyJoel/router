import { createController } from "../../router";

export default createController(
  async (ctrl) => {
    return Response.json({
      userId: ctrl.session.user.id,
      ctxUserId: ctrl.ctx.session.user.id,
      role: ctrl.user.role,
    });
  },
  { requiresAuthentication: true },
);
