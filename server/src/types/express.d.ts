import type { ServerAuthUser } from "../services/auth.service";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        sessionId: string;
        user: ServerAuthUser;
      };
    }
  }
}

export {};
