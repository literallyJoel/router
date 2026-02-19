import { createController } from "../../../../../src/controller";

export default createController(
  async (c) => Response.json({ id: c.params.id }),
  {
    requiresAuthentication: false,
    validateUUIDs: ["id"],
  }
);
