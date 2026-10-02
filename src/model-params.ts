import type { ModelParameterValue } from "@cursor/sdk";
import type { ChatCompletionRequest } from "./types.js";

const EFFORT_TO_PARAM: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
};

export function resolveModelSelection(
  body: ChatCompletionRequest,
  catalogParams?: Array<{ id: string }>,
): { id: string; params?: ModelParameterValue[] } {
  const rawModel = body.model?.trim() || "composer-2.5";
  const params: ModelParameterValue[] = [...(body.cursor?.params ?? [])];

  if (body.reasoning_effort) {
    const effort = body.reasoning_effort.toLowerCase();
    const paramId = catalogParams?.find(
      (p) =>
        p.id === "reasoning_effort" ||
        p.id === "effort" ||
        p.id.includes("effort"),
    )?.id;
    if (paramId && EFFORT_TO_PARAM[effort]) {
      params.push({ id: paramId, value: EFFORT_TO_PARAM[effort] });
    } else if (paramId) {
      params.push({ id: paramId, value: effort });
    }
  }

  return {
    id: rawModel,
    params: params.length > 0 ? params : undefined,
  };
}
