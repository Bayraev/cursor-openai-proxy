import type { SDKImage } from "@cursor/sdk";
import type { ChatMessage, ContentPart } from "./types.js";

function isContentParts(
  content: ChatMessage["content"],
): content is ContentPart[] {
  return Array.isArray(content);
}

function parseDataUrl(url: string): { data: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(url.trim());
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

export function extractImagesFromParts(parts: ContentPart[]): SDKImage[] {
  const images: SDKImage[] = [];
  for (const part of parts) {
    if (part.type !== "image_url") continue;
    const url = part.image_url.url;
    const dataUrl = parseDataUrl(url);
    if (dataUrl) {
      images.push({ data: dataUrl.data, mimeType: dataUrl.mimeType });
    } else {
      images.push({ url });
    }
  }
  return images;
}

/** Stateless transcript for harnesses that send full history each call. */
export function messagesToTranscript(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === "tool") continue;
    const label =
      msg.role === "system"
        ? "System"
        : msg.role === "assistant"
          ? "Assistant"
          : "User";
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (isContentParts(msg.content)) {
      text = msg.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
    }
    if (!text.trim()) continue;
    lines.push(`${label}:\n${text.trim()}`);
  }
  return lines.join("\n\n");
}

export function lastUserPayload(messages: ChatMessage[]): {
  text: string;
  images: SDKImage[];
} {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") {
      return { text: msg.content, images: [] };
    }
    if (isContentParts(msg.content)) {
      const text = msg.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      return {
        text,
        images: extractImagesFromParts(msg.content),
      };
    }
    return { text: "", images: [] };
  }
  return { text: "", images: [] };
}

export function buildUserMessage(
  messages: ChatMessage[],
  mode: "transcript" | "last",
): { text: string; images: SDKImage[] } {
  if (mode === "last") {
    const last = lastUserPayload(messages);
    const transcript = messagesToTranscript(
      messages.filter((m) => m.role !== "user" || m !== messages.at(-1)),
    );
    if (transcript.trim()) {
      return {
        text: `${transcript}\n\nUser:\n${last.text}`.trim(),
        images: last.images,
      };
    }
    return last;
  }
  const last = lastUserPayload(messages);
  const transcript = messagesToTranscript(messages);
  return {
    text: transcript,
    images: last.images,
  };
}
