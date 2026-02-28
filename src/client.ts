export interface HealthResponse {
  status: string;
  providers: Array<{ name: string; status: string; latency_ms?: number; error?: string }>;
  uptime_seconds: number;
}

export interface InventoryResponse {
  stacks: Record<string, {
    secrets: number;
    last_synced?: string;
    providers_used: string[];
    policies: string[];
  }>;
}

export interface AuditResponse {
  entries: Array<{
    ts: string;
    action: string;
    stack: string;
    secret: string;
    provider: string;
    policy: string;
    cache_hit: boolean;
    duration_ms: number;
    triggered_by?: string;
  }>;
  count: number;
}

export class HeraldClient {
  constructor(
    private url: string = process.env.HERALD_URL ?? 'http://herald:8765',
    private token: string = process.env.HERALD_API_TOKEN ?? ''
  ) {}

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
    const resp = await fetch(`${this.url}${path}`, { ...options, headers });
    if (!resp.ok) {
      throw new Error(`Herald API error: ${resp.status} ${await resp.text()}`);
    }
    return resp.json() as Promise<T>;
  }

  health() { return this.fetch<HealthResponse>('/v1/health'); }
  inventory() { return this.fetch<InventoryResponse>('/v1/inventory'); }
  audit(params: { stack?: string; secret?: string; hours?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.stack) qs.set('stack', params.stack);
    if (params.secret) qs.set('secret', params.secret);
    if (params.hours) qs.set('hours', String(params.hours));
    return this.fetch<AuditResponse>(`/v1/audit?${qs}`);
  }
  rotateCache(stack: string) {
    return this.fetch(`/v1/cache/${stack}`, { method: 'DELETE' });
  }
  sync(stack: string, outPath?: string) {
    return this.fetch('/v1/materialize/env', {
      method: 'POST',
      body: JSON.stringify({ stack, out_path: outPath }),
    });
  }
  rotate(itemId: string) {
    return this.fetch(`/v1/rotate/${itemId}`, { method: 'POST' });
  }
}
