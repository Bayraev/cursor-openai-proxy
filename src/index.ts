import "dotenv/config";
import { createServer } from "node:http";
import { handleChatCompletion, listModels } from "./chat.js";
import { SessionPool } from "./session-pool.js";
import type { ChatCompletionRequest } from "./types.js";

const PORT = Number(process.env.PORT ?? "8766");
const HOST = process.env.HOST ?? "127.0.0.1";
const CURSOR_API_KEY = process.env.CURSOR_API_KEY?.trim();
const PROXY_API_KEY = process.env.PROXY_API_KEY?.trim();
const CURSOR_WORKSPACE =
  process.env.CURSOR_WORKSPACE?.trim() || process.cwd();

if (!CURSOR_API_KEY) {
  console.error(
    "CURSOR_API_KEY is required. Copy .env.example to .env and set your key.",
  );
  process.exit(1);
}

const sessions = new SessionPool(CURSOR_API_KEY, CURSOR_WORKSPACE);

function checkProxyAuth(req: import("node:http").IncomingMessage): boolean {
  if (!PROXY_API_KEY) return true;
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  return header.slice("Bearer ".length).trim() === PROXY_API_KEY;
}

async function readJson<T>(req: import("node:http").IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    throw new Error("Empty request body");
  }
  return JSON.parse(raw) as T;
}

const server = createServer(async (req, res) => {
  try {
    if (!checkProxyAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "Invalid proxy API key", type: "authentication_error" },
        }),
      );
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          workspace: CURSOR_WORKSPACE,
          sdk: "local",
          note:
            "Uses @cursor/sdk local agents — same account/models as Cursor, not the IDE chat UI session.",
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      const models = await listModels(CURSOR_API_KEY);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: models }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = await readJson<ChatCompletionRequest>(req);
      const response = await handleChatCompletion(
        {
          apiKey: CURSOR_API_KEY,
          defaultCwd: CURSOR_WORKSPACE,
          sessions,
        },
        body,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Not found" } }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { message, type: "invalid_request_error" },
      }),
    );
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `cursor-openai-proxy listening on http://${HOST}:${PORT} (workspace: ${CURSOR_WORKSPACE})`,
  );
  console.log(
    "Deepseek Harness / OpenAI clients: base URL http://" +
      `${HOST}:${PORT}/v1` +
      (PROXY_API_KEY ? " with Bearer PROXY_API_KEY" : ""),
  );
});

async function shutdown() {
  await sessions.shutdown();
  server.close();
}

process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
