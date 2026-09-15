import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AssistantStreamEvent } from "shared/types";
import type { AssistantAuth, AssistantService } from "../assistant/service";
import { HttpError } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const chatSchema = z.object({
  body: z
    .object({
      conversationId: z.number().int().positive().optional(),
      message: z.string().trim().min(1).max(4000).optional(),
      retry: z.boolean().optional(),
      currentView: z.string().max(200).optional(),
      pageContext: z
        .object({
          view: z.string().max(200),
          params: z.record(z.string().max(120)).optional(),
        })
        .optional(),
      date: z.string().regex(DATE_PATTERN),
    })
    .refine((body) => body.retry === true || (body.message !== undefined && body.message.length > 0), {
      message: "message is required",
    }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const confirmSchema = z.object({
  body: z.object({
    conversationId: z.number().int().positive(),
    toolCallId: z.string().min(1),
    decision: z.enum(["confirm", "cancel"]),
    date: z.string().regex(DATE_PATTERN),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const conversationParamsSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.any().optional(),
  query: z.any().optional(),
});

function requestAuth(req: Request): AssistantAuth {
  const user = req.auth!.user;
  return {
    managerAccountId: user.accountId,
    workspaceId: user.workspaceId,
    displayName: user.displayName,
    role: user.role,
  };
}

async function streamEvents(
  req: Request,
  res: Response,
  next: NextFunction,
  run: (emit: (event: AssistantStreamEvent) => void, signal: AbortSignal) => Promise<void>
): Promise<void> {
  let streaming = false;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });

  const emit = (event: AssistantStreamEvent): void => {
    if (!streaming) {
      streaming = true;
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Accel-Buffering", "no");
      // Test helper responses are plain Writables without a socket; only real
      // ServerResponse objects can flush headers.
      if (typeof res.flushHeaders === "function" && res.socket) {
        res.flushHeaders();
      }
    }
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    await run(emit, controller.signal);
    res.end();
  } catch (error) {
    if (!streaming) {
      next(error);
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Assistant request failed";
    emit({ type: "error", error: message, status });
    res.end();
  }
}

export function createAssistantRouter(assistantService: AssistantService): Router {
  const router = Router();

  router.post("/chat", validate(chatSchema), async (req, res, next) => {
    const auth = requestAuth(req);
    await streamEvents(req, res, next, (emit, signal) =>
      assistantService.chat(auth, req.body, emit, signal)
    );
  });

  router.post("/actions/confirm", validate(confirmSchema), async (req, res, next) => {
    const auth = requestAuth(req);
    await streamEvents(req, res, next, (emit, signal) =>
      assistantService.confirmAction(auth, req.body, emit, signal)
    );
  });

  router.get("/conversations", async (req, res, next) => {
    try {
      const conversations = await assistantService.listConversations(requestAuth(req));
      res.json({ conversations });
    } catch (error) {
      next(error);
    }
  });

  router.get("/conversations/:id", validate(conversationParamsSchema), async (req, res, next) => {
    try {
      const detail = await assistantService.getConversation(requestAuth(req), Number(req.params.id));
      res.json(detail);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/conversations/:id", validate(conversationParamsSchema), async (req, res, next) => {
    try {
      await assistantService.deleteConversation(requestAuth(req), Number(req.params.id));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
