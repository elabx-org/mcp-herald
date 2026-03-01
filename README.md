# mcp-herald

MCP server that exposes [Herald](https://github.com/elabx-org/herald) secret management capabilities to Claude. Herald bridges 1Password to Komodo-managed Docker stacks, resolving `op://` references at deploy time.

## Tools

| Tool | Description |
|------|-------------|
| `herald_health` | Check Herald service health, provider status, latency, and rate-limit state |
| `herald_inventory` | Get the full secret coverage map across all stacks synced since Herald last started |
| `herald_audit` | Query the audit log for secret access history (filter by stack, secret, or time window) |
| `herald_rotate_cache` | Purge cached secrets for a stack so the next deploy fetches fresh values |
| `herald_sync` | Resolve `op://` refs in a raw env file and optionally write the result to a path |
| `herald_rotate` | Invalidate cache and redeploy all stacks using a given 1Password item (update the value in 1Password first) |
| `herald_provision_secret` | Create or upsert a secret item in a 1Password vault; auto-generates values for empty fields |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HERALD_URL` | `http://herald:8765` | Base URL of the Herald service |
| `HERALD_API_TOKEN` | — | API token for Herald authentication |
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `sse` |
| `MCP_HOST` | `0.0.0.0` | Bind address (SSE mode only) |
| `MCP_PORT` | `8000` | Listen port (SSE mode only) |

## Usage

### stdio (Claude Code / local)

Build the project (see Development below), then add an entry to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "herald": {
      "command": "node",
      "args": ["/path/to/mcp-herald/dist/index.js"],
      "env": {
        "HERALD_URL": "http://herald:8765",
        "HERALD_API_TOKEN": "your-token"
      }
    }
  }
}
```

### SSE (Docker container)

The prebuilt image is available at `ghcr.io/elabx-org/mcp-herald:latest`.

```yaml
services:
  mcp-herald:
    image: ghcr.io/elabx-org/mcp-herald:latest
    environment:
      - MCP_TRANSPORT=sse
      - MCP_HOST=0.0.0.0
      - MCP_PORT=8000
      - HERALD_URL=http://herald:8765
      - HERALD_API_TOKEN=your-token
    ports:
      - "8000:8000"
```

The SSE endpoint is available at `http://mcp-herald:8000/sse`.

To rebuild the image via Komodo:

```
mcp__komodo__run_build(build="mcp-herald")
```

## Development

```bash
npm install
npm run build   # compiles TypeScript → dist/
```

The `dist/` directory is gitignored. Always build locally after cloning.

Source files:
- `src/index.ts` — MCP server entry point and tool definitions
- `src/client.ts` — Herald HTTP client
