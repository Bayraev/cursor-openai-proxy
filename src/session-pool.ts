import { Agent, type SDKAgent } from "@cursor/sdk";
import type { ModelParameterValue } from "@cursor/sdk";

const SESSION_TTL_MS = 30 * 60 * 1000;

interface SessionEntry {
  agent: SDKAgent;
  lastUsed: number;
}

export class SessionPool {
  private sessions = new Map<string, SessionEntry>();
  private sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly apiKey: string,
    private readonly defaultCwd: string,
  ) {
    this.sweeper = setInterval(() => this.evictIdle(), 60_000);
  }

  async getOrCreate(
    sessionId: string,
    model: { id: string; params?: ModelParameterValue[] },
    cwd: string,
  ): Promise<SDKAgent> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.agent;
    }
    const agent = await Agent.create({
      apiKey: this.apiKey,
      model,
      local: { cwd, settingSources: [] },
    });
    this.sessions.set(sessionId, { agent, lastUsed: Date.now() });
    return agent;
  }

  private async evictIdle(): Promise<void> {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastUsed < SESSION_TTL_MS) continue;
      this.sessions.delete(id);
      try {
        await entry.agent[Symbol.asyncDispose]();
      } catch {
        /* ignore */
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const [id, entry] of this.sessions) {
      this.sessions.delete(id);
      try {
        await entry.agent[Symbol.asyncDispose]();
      } catch {
        /* ignore */
      }
    }
  }
}
