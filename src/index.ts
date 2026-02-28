import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { HeraldClient } from './client.js';

const client = new HeraldClient();
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

const transport = new StdioServerTransport();
await server.connect(transport);
