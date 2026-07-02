# ncu-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that
exposes node-core-utils tools to AI agents.

## Setup

Add the server to your MCP client configuration. Replace
`/path/to/node-core-utils` with the actual path to this repository.

### Claude Code

This repository includes `.mcp.json`, so no manual configuration is needed
when working inside it. For other projects, add to `.mcp.json`:

```json
{
  "mcpServers": {
    "ncu-mcp": {
      "command": "node",
      "args": ["/path/to/node-core-utils/bin/ncu-mcp.js"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ncu-mcp": {
      "command": "node",
      "args": ["/path/to/node-core-utils/bin/ncu-mcp.js"]
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "mcpServers": {
    "ncu-mcp": {
      "command": "node",
      "args": ["/path/to/node-core-utils/bin/ncu-mcp.js"]
    }
  }
}
```

### Codex CLI

Add to `.codex/config.toml` (project) or `~/.codex/config.toml` (global,
macOS/Linux) or `%USERPROFILE%\.codex\config.toml` (global, Windows):

```toml
[mcp_servers.ncu-mcp]
command = "node"
args = ["/path/to/node-core-utils/bin/ncu-mcp.js"]
```

### Claude Desktop

Add to the config file for your platform:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ncu-mcp": {
      "command": "node",
      "args": ["/path/to/node-core-utils/bin/ncu-mcp.js"]
    }
  }
}
```

## Prerequisites

GitHub and Jenkins credentials must be configured before using the tools.
See the [README](../README.md) for setup instructions.

## Tools

### `git_node_metadata`

Fetch metadata for a Node.js pull request, including collaborator approvals,
CI status, and review information. Equivalent to
[`git node metadata`](./git-node.md#git-node-metadata).

Input:

| Parameter | Type | Description |
|---|---|---|
| `pr` | string | Pull request URL or number, e.g. `https://github.com/nodejs/node/pull/12345` or `12345` |

### `git_node_land`

Land a Node.js pull request. Equivalent to
[`git node land`](./git-node.md#git-node-land).

Input:

| Parameter | Type | Description |
|---|---|---|
| `pr` | string | Pull request URL or number |
| `yes` | boolean | Skip confirmation prompts (optional) |

### `git_node_status`

Show the status of an in-progress pull request landing. Equivalent to
[`git node status`](./git-node.md).

### `ncu_ci`

Check CI status for a Node.js pull request.

Input:

| Parameter | Type | Description |
|---|---|---|
| `pr` | string | Pull request URL or number |
