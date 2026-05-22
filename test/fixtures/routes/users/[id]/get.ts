import { createController } from "../../../router";

export default createController(
  async (c) => Response.json({ id: c.params.id }),
  {
    requiresAuthentication: false,
    validateUUIDs: ["id"],
  },
);
