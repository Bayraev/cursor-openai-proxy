import {
  Agent,
  Cursor,
  CursorAgentError,
  type ModelParameterValue,
} from "@cursor/sdk";
import { buildUserMessage, lastUserPayload } from "./messages.js";
import { resolveModelSelection } from "./model-params.js";
import type { SessionPool } from "./session-pool.js";
import type { ChatCompletionRequest } from "./types.js";

function chunkId(): string {
  return `chatcmpl-${crypto.randomUUID().replace(/-/g, "")}`;
}

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export interface ChatHandlerDeps {
  apiKey: string;
  defaultCwd: string;
  sessions: SessionPool;
}

export async function listModels(apiKey: string) {
  const models = await Cursor.models.list({ apiKey });
  const created = Math.floor(Date.now() / 1000);
  return models.map((m) => ({
    id: m.id,
    object: "model" as const,
    created,
    owned_by: "cursor",
    cursor: {
      displayName: m.displayName,
      parameters: m.parameters,
      variants: m.variants,
    },
  }));
}

export async function handleChatCompletion(
  deps: ChatHandlerDeps,
  body: ChatCompletionRequest,
): Promise<Response> {
  const cwd = body.cursor?.workspace?.trim() || deps.defaultCwd;
  const sessionId =
    body.cursor?.session_id?.trim() || body.user?.trim() || undefined;
  const includeThinking = body.cursor?.include_thinking !== false;

  let catalogParams: Array<{ id: string }> | undefined;
  try {
    const models = await Cursor.models.list({ apiKey: deps.apiKey });
    catalogParams = models.find((m) => m.id === body.model)?.parameters;
  } catch {
    /* list is best-effort for effort mapping */
  }

  const model = resolveModelSelection(body, catalogParams);
  const { text, images } = sessionId
    ? lastUserPayload(body.messages)
    : buildUserMessage(body.messages, "transcript");

  if (!text.trim() && images.length === 0) {
    return jsonError(400, "messages must include at least one user text or image");
  }

  const userMessage =
    images.length > 0
      ? { text: text.trim() || "Describe the attached image(s).", images }
      : text.trim();

  if (body.stream) {
    return streamCompletion(deps, {
      cwd,
      sessionId,
      model,
      userMessage,
      requestModel: body.model,
      includeThinking,
    });
  }

  return nonStreamCompletion(deps, {
    cwd,
    sessionId,
    model,
    userMessage,
    requestModel: body.model,
    includeThinking,
  });
}

interface RunOpts {
  cwd: string;
  sessionId?: string;
  model: { id: string; params?: ModelParameterValue[] };
  userMessage: string | { text: string; images: { url?: string; data?: string; mimeType?: string }[] };
  requestModel: string;
  includeThinking: boolean;
}

async function runWithAgent(
  deps: ChatHandlerDeps,
  opts: RunOpts,
  onEvent?: (delta: string) => void,
): Promise<{ content: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
  let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
  let disposeAgent = false;

  try {
    if (opts.sessionId) {
      agent = await deps.sessions.getOrCreate(
        opts.sessionId,
        opts.model,
        opts.cwd,
      );
    } else {
      agent = await Agent.create({
        apiKey: deps.apiKey,
        model: opts.model,
        local: { cwd: opts.cwd, settingSources: [] },
      });
      disposeAgent = true;
    }

    const run = await agent.send(
      opts.userMessage as Parameters<typeof agent.send>[0],
    );
    let content = "";

    for await (const event of run.stream()) {
      if (event.type === "thinking" && opts.includeThinking && onEvent) {
        onEvent(event.text);
        content += event.text;
      }
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text") {
            if (onEvent) onEvent(block.text);
            content += block.text;
          }
        }
      }
    }

    const result = await run.wait();
    if (result.status === "error") {
      throw new Error(result.error?.message ?? "Cursor run failed");
    }
    if (!content && result.result) {
      content = result.result;
    }

    const usage = result.usage
      ? {
          prompt_tokens: result.usage.inputTokens ?? 0,
          completion_tokens: result.usage.outputTokens ?? 0,
          total_tokens: result.usage.totalTokens ?? 0,
        }
      : undefined;

    return { content, usage };
  } finally {
    if (disposeAgent && agent) {
      try {
        await agent[Symbol.asyncDispose]();
      } catch {
        /* ignore */
      }
    }
  }
}

async function nonStreamCompletion(
  deps: ChatHandlerDeps,
  opts: RunOpts,
): Promise<Response> {
  try {
    const { content, usage } = await runWithAgent(deps, opts);
    const id = chunkId();
    return json(200, {
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: opts.requestModel,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
  } catch (err) {
    return agentErrorResponse(err);
  }
}

async function streamCompletion(
  deps: ChatHandlerDeps,
  opts: RunOpts,
): Promise<Response> {
  const id = chunkId();
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(sseLine(payload)));
      };

      send({
        id,
        object: "chat.completion.chunk",
        created,
        model: opts.requestModel,
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      });

      try {
        await runWithAgent(deps, opts, (delta) => {
          send({
            id,
            object: "chat.completion.chunk",
            created,
            model: opts.requestModel,
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
          });
        });

        send({
          id,
          object: "chat.completion.chunk",
          created,
          model: opts.requestModel,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error during stream";
        send({
          error: { message, type: "server_error" },
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(status: number, message: string): Response {
  return json(status, {
    error: { message, type: "invalid_request_error" },
  });
}

function agentErrorResponse(err: unknown): Response {
  if (err instanceof CursorAgentError) {
    return json(err.isRetryable ? 503 : 401, {
      error: {
        message: err.message,
        type: err.isRetryable ? "server_error" : "authentication_error",
      },
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return json(500, { error: { message, type: "server_error" } });
}
