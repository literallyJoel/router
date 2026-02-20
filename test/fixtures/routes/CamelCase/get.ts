import { createController } from "../../../../src/controller";

export default createController(async () => Response.json({ ok: true }), {
  requiresAuthentication: false,
});
