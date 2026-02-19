import { createController } from "../../../../src/controller";

export default createController(
  async () => Response.json({ method: "POST", path: "/users" }),
  { requiresAuthentication: false },
);
