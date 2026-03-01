import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer } from 'node:http';
import { z } from 'zod';
import { HeraldClient } from './client.js';

const client = new HeraldClient();

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'herald', version: '1.0.0' });

  server.tool('herald_health', 'Check Herald service health and provider status', {}, async () => {
    const data = await client.health();
    const providerLines = data.providers.map(p => {
      const typeLabel = p.type === 'connect_server' ? 'Connect (local, no rate limits)'
        : p.type === 'service_account' ? 'Service Account (cloud API, rate-limited)'
        : p.type ?? 'unknown';
      const rateNote = p.rate_limited_since ? ` ⚠ rate-limited since ${p.rate_limited_since}` : '';
      return `  ${p.name} [${typeLabel}] — ${p.status}${p.error ? `: ${p.error}` : ''}${rateNote}`;
    });
    const provisionerLabel = data.provisioner === 'connect' ? 'Connect (local REST API, no rate limits)'
      : data.provisioner === 'sdk' ? 'SDK service account (cloud API, rate-limited)'
      : 'unavailable';
    const summary = [
      `Status: ${data.status}`,
      `Uptime: ${data.uptime_seconds}s`,
      `Provisioner: ${provisionerLabel}`,
      '',
      'Read providers (priority order):',
      ...providerLines,
    ].join('\n');
    return { content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }] };
  });

  server.tool('herald_inventory', 'Get full secret coverage map across all stacks', {}, async () => {
    const data = await client.inventory();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.tool('herald_audit', 'Query audit log for secret access history',
    { stack: z.string().optional(), secret: z.string().optional(), hours: z.number().optional() },
    async ({ stack, secret, hours }) => {
      const data = await client.audit({ stack, secret, hours });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool('herald_rotate_cache', 'Force fresh secret fetch for a stack (purge cache)',
    { stack: z.string() },
    async ({ stack }) => {
      await client.rotateCache(stack);
      return { content: [{ type: 'text', text: `Cache cleared for stack: ${stack}` }] };
    }
  );

  server.tool('herald_sync', 'Resolve op:// secrets for a stack. env_content is the raw env file contents with op:// refs (e.g. "KEY=op://Vault/Item/field\\nKEY2=op://...").',
    { stack: z.string(), env_content: z.string(), out_path: z.string().optional(), bypass_cache: z.boolean().optional() },
    async ({ stack, env_content, out_path, bypass_cache }) => {
      const data = await client.sync(stack, env_content, out_path, bypass_cache);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool('herald_rotate', 'Trigger cache invalidation + redeployment for stacks using a 1Password item. Does NOT change the secret value in 1Password — update the value there first, then call this.',
    { item_id: z.string() },
    async ({ item_id }) => {
      const [health, data] = await Promise.all([
        client.health(),
        client.rotate(item_id),
      ]);
      const connectProvider = health.providers.find(p => p.type === 'connect_server' && p.status === 'ok');
      const updateHint = connectProvider
        ? `To update the secret value: use the 1Password Connect REST API (${connectProvider.name}) or the 1Password web UI, then run herald_rotate again.`
        : `To update the secret value: use the 1Password web UI or CLI, then run herald_rotate again.`;
      const lines = [
        'Rotation triggered: cache invalidated and affected stacks redeployed.',
        updateHint,
        '',
        JSON.stringify(data, null, 2),
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'herald_provision_secret',
    'Create or upsert a secret item in a 1Password vault. Fields with empty values are auto-generated. Returns op:// refs for each field. Note: if the item already exists, only MISSING fields are added — existing field values are never overwritten.',
    {
      vault: z.string().describe('Vault name, e.g. "HomeLab"'),
      item: z.string().describe('Item title, e.g. "my-app-prod"'),
      category: z.enum(['login', 'api_credentials', 'secure_note']).optional().describe('Item category (default: login)'),
      fields: z.record(
        z.string(),
        z.object({
          value: z.string().optional().describe('Field value; omit or leave empty to auto-generate'),
          concealed: z.boolean().optional().describe('Store as concealed/password field (auto-detected from field name if omitted)'),
        })
      ).describe('Map of field names to their spec'),
    },
    async ({ vault, item, category, fields }) => {
      const [health, data] = await Promise.all([
        client.health(),
        client.provision({ vault, item, category, fields: fields as Record<string, { value?: string; concealed?: boolean }> }),
      ]);
      const provisioner = health.provisioner ?? 'unknown';
      const provisionerNote = provisioner === 'connect'
        ? 'Provisioned via Connect server (local REST API, no rate limits).\n⚠ Upsert limitation: if the item already existed, only new fields were added — existing field values were NOT updated. To update an existing field value, delete the item in 1Password and re-provision.'
        : provisioner === 'sdk'
        ? 'Provisioned via SDK service account (cloud API). Upsert limitation applies equally: existing field values are never overwritten.'
        : `Provisioner: ${provisioner}`;
      const lines = [
        `Created/updated item "${item}" in vault "${vault}"`,
        `Item ID: ${data.item_id}`,
        '',
        'op:// references (use these in extra.env):',
        ...Object.entries(data.refs).map(([field, ref]) => `  ${field}=${ref}`),
        '',
        provisionerNote,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  return server;
}

const transportMode = process.env.MCP_TRANSPORT ?? 'stdio';

if (transportMode === 'sse') {
  const host = process.env.MCP_HOST ?? '0.0.0.0';
  const port = parseInt(process.env.MCP_PORT ?? '8000', 10);

  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req, res) => {
    if (!req.url) { res.writeHead(400).end(); return; }
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/message', res);
      transports.set(transport.sessionId, transport);
      res.on('close', () => transports.delete(transport.sessionId));
      await createMcpServer().connect(transport);
    } else if (req.method === 'POST' && url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(400).end('Unknown session');
        return;
      }
      await transport.handlePostMessage(req, res);
    } else {
      res.writeHead(404).end('Not Found');
    }
  });

  httpServer.listen(port, host, () => {
    process.stderr.write(`Herald MCP server (SSE) listening on ${host}:${port}\n`);
  });
} else {
  const transport = new StdioServerTransport();
  await createMcpServer().connect(transport);
}
