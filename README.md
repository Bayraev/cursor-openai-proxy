# cursor-openai-proxy

Local **OpenAI-compatible** HTTP API that runs **Cursor models** through the official [`@cursor/sdk`](https://cursor.com/docs/sdk/typescript) **local agent** — **no Cursor CLI** (`agent` / `cursor-agent`) required.

Use it from another harness (e.g. Deepseek Harness) by pointing `base_url` at this server.

## What this is / is not

| | |
|---|---|
| **Is** | Same Cursor account, model catalog, reasoning/effort params, images, local workspace tools (files, terminal, etc.) via the SDK local runtime |
| **Is not** | The Cursor IDE chat panel you have open right now — there is no supported API to “remote control” that UI session |

If you only need chat completions without workspace tools, `CURSOR_API_KEY` + this proxy is enough. For CLI-shaped parity without the SDK, community projects like [`cursor-api-proxy`](https://www.npmjs.com/package/cursor-api-proxy) wrap the **Cursor agent CLI** instead.

## Note

You can run this proxy, then ask your another harness to add models in the list.

## Setup

1. Create a key: [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations) (or a team service account).
2. Copy `.env.example` → `.env` and set `CURSOR_API_KEY`.
3. Install and run:

```bash
cd cursor-openai-proxy
npm install
npm run dev
```

Default URL: `http://127.0.0.1:8766/v1`

## Deepseek Harness (example)

```env
OPENAI_API_BASE=http://127.0.0.1:8766/v1
OPENAI_API_KEY=unused
# or set PROXY_API_KEY in .env and use that as OPENAI_API_KEY
```

Pick a model from `GET /v1/models` (e.g. `composer-2.5`, `auto-smart`).

## Request features

### Models & effort

- `model` — any id from `/v1/models`.
- `reasoning_effort` — `low` \| `medium` \| `high` when the model exposes a matching parameter in the catalog.
- `cursor.params` — explicit SDK params, e.g. `[{ "id": "fast", "value": "true" }]` or Router `optimize_for`.

```json
{
  "model": "composer-2.5",
  "reasoning_effort": "high",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

### Images

OpenAI-style `image_url` parts on the **last user** message (`https://...` or `data:image/png;base64,...`).

### Multi-turn (optional)

Send the full `messages` history each time (stateless), **or** set `cursor.session_id` (or OpenAI `user`) to keep one SDK agent and context:

```json
{
  "model": "composer-2.5",
  "user": "my-harness-session-1",
  "messages": [
    { "role": "user", "content": "Remember the codeword is banana." },
    { "role": "assistant", "content": "Got it." },
    { "role": "user", "content": "What was the codeword?" }
  ]
}
```

With `session_id`, only the latest user turn is sent to the agent; prior turns live in the agent memory. Without it, the proxy flattens the full transcript into one prompt.

### Workspace

```json
{
  "cursor": { "workspace": "d:\\coding\\my-projects" }
}
```

Or set `CURSOR_WORKSPACE` in `.env`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Status + workspace |
| GET | `/v1/models` | Cursor model catalog |
| POST | `/v1/chat/completions` | Chat (JSON or SSE `stream: true`) |

## Security

- Binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` only on a trusted network.
- Set `PROXY_API_KEY` so clients must send `Authorization: Bearer <key>`.
- The local agent can read/edit files and run commands in `CURSOR_WORKSPACE` — same power as a local Cursor agent.
#
