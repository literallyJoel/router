import { serve } from "bun";
import { getRoutes } from "./router";

const routes = await getRoutes();

const server = serve({
  routes: {
    ...routes,
    "/api/*": new Response("Not Found", { status: 404 }),
    "/*": Response.json({ ok: true, message: "Router example" }),
  },
  port: 3000,
});

console.log(`Server running at ${server.url}`);
