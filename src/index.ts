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
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
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

  server.tool('herald_sync', 'Trigger manual secret sync for a stack',
    { stack: z.string(), out_path: z.string().optional() },
    async ({ stack, out_path }) => {
      const data = await client.sync(stack, out_path);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool('herald_rotate', 'Trigger secret rotation for a 1Password item ID (invalidates cache + redeploys affected stacks)',
    { item_id: z.string() },
    async ({ item_id }) => {
      const data = await client.rotate(item_id);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'herald_provision_secret',
    'Create a new secret item in a 1Password vault. Fields with empty values are auto-generated. Returns op:// refs for each field.',
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
      const data = await client.provision({ vault, item, category, fields: fields as Record<string, { value?: string; concealed?: boolean }> });
      const lines = [
        `Created item "${item}" in vault "${vault}"`,
        `Item ID: ${data.item_id}`,
        '',
        'op:// references (use these in extra.env):',
        ...Object.entries(data.refs).map(([field, ref]) => `  ${field}=${ref}`),
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
