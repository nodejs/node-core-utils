import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { forceRunAsync } from './run.js';

const GIT_NODE = new URL('../bin/git-node.js', import.meta.url).pathname;

function capture(cmd, args) {
  return forceRunAsync(cmd, args, {
    captureStdout: true,
    captureStderr: true,
    ignoreFailure: false
  });
}

const TOOLS = [
  {
    name: 'git_node_metadata',
    description: 'Fetch metadata for a Node.js pull request ' +
      '(collaborators, CI status, reviews, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        pr: {
          type: 'string',
          description: 'Pull request URL or number, e.g. ' +
            'https://github.com/nodejs/node/pull/12345 or 12345'
        }
      },
      required: ['pr']
    }
  },
  {
    name: 'git_node_land',
    description: 'Land a Node.js pull request (interactive landing process)',
    inputSchema: {
      type: 'object',
      properties: {
        pr: {
          type: 'string',
          description: 'Pull request URL or number'
        },
        yes: {
          type: 'boolean',
          description: 'Skip confirmation prompts (default: false)'
        }
      },
      required: ['pr']
    }
  },
  {
    name: 'git_node_status',
    description: 'Show the status of a Node.js pull request landing',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'ncu_ci',
    description: 'Check CI status for a Node.js pull request or commit',
    inputSchema: {
      type: 'object',
      properties: {
        pr: {
          type: 'string',
          description: 'Pull request URL or number'
        }
      },
      required: ['pr']
    }
  }
];

export function createServer(captureImpl = capture) {
  const server = new Server(
    { name: 'ncu-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async() => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async(request) => {
    const { name, arguments: args } = request.params;

    try {
      let output;

      switch (name) {
        case 'git_node_metadata': {
          output = await captureImpl('node', [GIT_NODE, 'metadata', String(args.pr)]);
          break;
        }
        case 'git_node_land': {
          const landArgs = ['land', String(args.pr)];
          if (args.yes) landArgs.push('--yes');
          output = await captureImpl('node', [GIT_NODE, ...landArgs]);
          break;
        }
        case 'git_node_status': {
          output = await captureImpl('node', [GIT_NODE, 'status']);
          break;
        }
        case 'ncu_ci': {
          output = await captureImpl('node', [GIT_NODE, 'metadata', '--ci', String(args.pr)]);
          break;
        }
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true
          };
      }

      return {
        content: [{ type: 'text', text: String(output) }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true
      };
    }
  });

  return server;
}

export async function run() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
