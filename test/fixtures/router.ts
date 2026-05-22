import { createRouter } from "../../src/router";

type FixtureSession =
  | {
      user: {
        id: string;
        role: "admin" | "member";
      };
    }
  | null;

export const { createController } = createRouter<FixtureSession>({
  routesDirectory: "./test/fixtures/routes",
  sessionGetter: async (): Promise<FixtureSession> => null,
});
