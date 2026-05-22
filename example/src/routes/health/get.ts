import { createController } from "../../router";

export default createController(
  async () => Response.json({ ok: true }),
  { requiresAuthentication: false },
);
