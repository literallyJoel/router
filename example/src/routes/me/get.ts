import { createController } from "../../router";

export default createController(
  async (ctrl) => {
    return Response.json({
      id: ctrl.session.user.id,
      role: ctrl.user.role,
    });
  },
  { requiresAuthentication: true },
);
