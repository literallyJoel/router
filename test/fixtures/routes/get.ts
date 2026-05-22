import { createController } from "../router";

export default createController(async () => Response.json({ method: "GET" }), {
  requiresAuthentication: false,
});
