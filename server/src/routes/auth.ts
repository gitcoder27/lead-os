import { Router } from "express";
import { z } from "zod";
import type { AuthBootstrapResponse, AuthSessionResponse, AuthUser } from "shared/types";
import { validate } from "../middleware/validate";
import { requireAuth, requireManager } from "../middleware/auth";
import { AuthService, clearSessionCookie, serializeSessionCookie, SESSION_COOKIE_NAME } from "../services/auth.service";
import { TaskKeysService } from "../services/task-keys.service";
import { OneOnOneService } from "../services/one-on-one.service";
import { HttpError } from "../middleware/errorHandler";

const loginSchema = z.object({
  body: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const registerSchema = z.object({
  body: z.object({
    username: z.string().min(1).max(100),
    password: z.string().min(6).max(200),
    displayName: z.string().min(1).max(200),
    role: z.enum(["manager", "developer"]),
    developerAccountId: z.string().optional(),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const changePasswordSchema = z.object({
  body: z.object({
    username: z.string().min(1).max(100),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6).max(200),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const deleteUserSchema = z.object({
  body: z.any().optional(),
  params: z.object({
    username: z.string().min(1).max(100),
  }),
  query: z.any().optional(),
});

class AuthAttemptThrottle {
  private readonly attempts = new Map<string, { failures: number; lockedUntil?: number; lastFailureAt: number }>();

  assertAllowed(key: string): void {
    const attempt = this.attempts.get(key);
    if (!attempt?.lockedUntil) {
      return;
    }
    if (attempt.lockedUntil <= Date.now()) {
      this.attempts.delete(key);
      return;
    }
    throw new HttpError(429, "Too many failed attempts. Try again later.");
  }

  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const previous = this.attempts.get(key);
    const failures = previous && now - previous.lastFailureAt < 15 * 60_000
      ? previous.failures + 1
      : 1;
    const lockedUntil = failures >= 5
      ? now + Math.min(15 * 60_000, (failures - 4) * 30_000)
      : undefined;
    this.attempts.set(key, { failures, lockedUntil, lastFailureAt: now });
  }
}

function throttleKey(req: { ip?: string; socket?: { remoteAddress?: string } }, username: string): string {
  return `${req.ip ?? req.socket?.remoteAddress ?? "unknown"}:${username.trim().toLowerCase()}`;
}

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();
  const throttle = new AuthAttemptThrottle();
  const taskKeys = new TaskKeysService();
  const oneOnOnes = new OneOnOneService();
  const sessionResponse = async (user: AuthUser): Promise<AuthSessionResponse> => ({
    user,
    // docs/48: `oneOnOne` is manager-only — developer sessions never receive it.
    features: {
      tasksPhase3: await taskKeys.phase3Enabled(user.workspaceId),
      ...(user.role === "manager" ? { oneOnOne: await oneOnOnes.enabled(user.workspaceId) } : {}),
    },
  });

  router.get("/bootstrap", async (_req, res, next) => {
    try {
      const userCount = await authService.getUserCount();
      const response: AuthBootstrapResponse = {
        bootstrapOpen: userCount === 0,
        userCount,
      };
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.post("/login", validate(loginSchema), async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const key = throttleKey(req, username);
      throttle.assertAllowed(key);
      const result = await authService.authenticate(username, password);
      throttle.recordSuccess(key);
      res.setHeader(
        "Set-Cookie",
        serializeSessionCookie(result.sessionId, authService.sessionMaxAgeSeconds)
      );
      res.json(await sessionResponse(result.user));
    } catch (error) {
      if (req.body?.username && error instanceof HttpError && error.status === 401) {
        throttle.recordFailure(throttleKey(req, req.body.username));
      }
      next(error);
    }
  });

  router.post("/register", validate(registerSchema), async (req, res, next) => {
    try {
      const userCount = await authService.getUserCount();
      const isBootstrap = userCount === 0;
      let caller: AuthUser | undefined;

      if (isBootstrap && req.body.role !== "manager") {
        res.status(403).json({ error: "The first account must be a manager", status: 403 });
        return;
      }

      // If users already exist, only a logged-in manager can create new users.
      if (!isBootstrap) {
        const cookies = parseCookieHeader(req.headers.cookie);
        const sessionId = cookies[SESSION_COOKIE_NAME];
        if (!sessionId) {
          res.status(401).json({ error: "Authentication required", status: 401 });
          return;
        }
        caller = await authService.getUserForSession(sessionId);
        if (!caller || caller.role !== "manager") {
          res.status(403).json({ error: "Only managers can create users", status: 403 });
          return;
        }
      }

      const { username, password, displayName, role, developerAccountId } = req.body;
      const user = await authService.createUser({
        username,
        password,
        displayName,
        role,
        workspaceId: caller?.workspaceId,
        developerAccountId,
      });

      if (isBootstrap && role === "manager") {
        const result = await authService.authenticate(username, password);
        res.setHeader(
          "Set-Cookie",
          serializeSessionCookie(result.sessionId, authService.sessionMaxAgeSeconds)
        );
      }

      res.status(201).json({ user });
    } catch (error) {
      next(error);
    }
  });

  router.post("/change-password", validate(changePasswordSchema), async (req, res, next) => {
    try {
      const { username, currentPassword, newPassword } = req.body;
      const key = throttleKey(req, username);
      throttle.assertAllowed(key);
      await authService.changePassword(username, currentPassword, newPassword);
      throttle.recordSuccess(key);
      res.json({ ok: true });
    } catch (error) {
      if (req.body?.username && error instanceof HttpError && error.status === 401) {
        throttle.recordFailure(throttleKey(req, req.body.username));
      }
      next(error);
    }
  });

  router.get("/users", requireManager(authService), async (req, res, next) => {
    try {
      const users = await authService.listUsers(req.auth!.user.workspaceId);
      res.json({ users });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/users/:username", requireManager(authService), validate(deleteUserSchema), async (req, res, next) => {
    try {
      const username = req.params.username;
      if (!username) {
        res.status(400).json({ error: "username is required", status: 400 });
        return;
      }
      await authService.deleteUser(username, req.auth!.user.workspaceId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", requireAuth(authService), async (req, res, next) => {
    try {
      res.json(await sessionResponse(req.auth!.user));
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", requireAuth(authService), async (req, res, next) => {
    try {
      await authService.invalidateSession(req.auth!.sessionId);
      res.setHeader("Set-Cookie", clearSessionCookie());
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function parseCookieHeader(header?: string): Record<string, string> {
  if (!header) return {};
  return header
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const idx = part.indexOf("=");
      if (idx > 0) {
        acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
      }
      return acc;
    }, {});
}
