import { createController } from "../../../src/controller";

export default createController(async () => Response.json({ method: "GET" }), {
  requiresAuthentication: false,
});
