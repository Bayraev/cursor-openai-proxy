export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[] | null;
  name?: string;
}

export interface CursorExtension {
  /** Persist multi-turn context via a local SDK agent (optional). */
  session_id?: string;
  /** Override workspace cwd for this request. */
  workspace?: string;
  /** Explicit Cursor model params, e.g. [{ id: "fast", value: "true" }]. */
  params?: Array<{ id: string; value: string }>;
  /** Include thinking stream chunks in the assistant text (default true). */
  include_thinking?: boolean;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  user?: string;
  reasoning_effort?: "low" | "medium" | "high" | string;
  cursor?: CursorExtension;
}

export interface OpenAIModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}
