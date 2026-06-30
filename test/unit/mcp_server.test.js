import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../../lib/mcp_server.js';

const GIT_NODE = new URL('../../bin/git-node.js', import.meta.url).pathname;

async function connect(captureImpl) {
  const server = createServer(captureImpl);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);
  return { client, server };
}

describe('mcp_server', () => {
  describe('tools/list', () => {
    it('should return all four tools', async() => {
      const { client } = await connect();
      const { tools } = await client.listTools();
      assert.deepStrictEqual(
        tools.map(t => t.name),
        ['git_node_metadata', 'git_node_land', 'git_node_status', 'ncu_ci']
      );
    });

    it('should require pr for git_node_metadata', async() => {
      const { client } = await connect();
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'git_node_metadata');
      assert.deepStrictEqual(tool.inputSchema.required, ['pr']);
    });

    it('should require pr for git_node_land', async() => {
      const { client } = await connect();
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'git_node_land');
      assert.deepStrictEqual(tool.inputSchema.required, ['pr']);
    });

    it('should have optional yes parameter for git_node_land', async() => {
      const { client } = await connect();
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'git_node_land');
      assert.strictEqual(tool.inputSchema.properties.yes.type, 'boolean');
    });
  });

  describe('tools/call', () => {
    it('should return error for unknown tool', async() => {
      const { client } = await connect();
      const result = await client.callTool({ name: 'no_such_tool', arguments: {} });
      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes('Unknown tool'));
    });

    it('should call git_node_metadata with correct args', async() => {
      let capturedArgs;
      const mockCapture = async(cmd, args) => {
        capturedArgs = { cmd, args };
        return 'metadata output';
      };
      const { client } = await connect(mockCapture);
      const result = await client.callTool({
        name: 'git_node_metadata',
        arguments: { pr: '12345' }
      });
      assert.deepStrictEqual(capturedArgs, {
        cmd: 'node',
        args: [GIT_NODE, 'metadata', '12345']
      });
      assert.strictEqual(result.content[0].text, 'metadata output');
    });

    it('should call git_node_land with correct args', async() => {
      let capturedArgs;
      const mockCapture = async(cmd, args) => {
        capturedArgs = { cmd, args };
        return 'land output';
      };
      const { client } = await connect(mockCapture);
      await client.callTool({ name: 'git_node_land', arguments: { pr: '42' } });
      assert.deepStrictEqual(capturedArgs, {
        cmd: 'node',
        args: [GIT_NODE, 'land', '42']
      });
    });

    it('should append --yes when yes is true for git_node_land', async() => {
      let capturedArgs;
      const mockCapture = async(cmd, args) => {
        capturedArgs = { cmd, args };
        return '';
      };
      const { client } = await connect(mockCapture);
      await client.callTool({ name: 'git_node_land', arguments: { pr: '42', yes: true } });
      assert.deepStrictEqual(capturedArgs.args, [GIT_NODE, 'land', '42', '--yes']);
    });

    it('should call git_node_status with no extra args', async() => {
      let capturedArgs;
      const mockCapture = async(cmd, args) => {
        capturedArgs = { cmd, args };
        return 'status output';
      };
      const { client } = await connect(mockCapture);
      const result = await client.callTool({ name: 'git_node_status', arguments: {} });
      assert.deepStrictEqual(capturedArgs, {
        cmd: 'node',
        args: [GIT_NODE, 'status']
      });
      assert.strictEqual(result.content[0].text, 'status output');
    });

    it('should call ncu_ci with correct args', async() => {
      let capturedArgs;
      const mockCapture = async(cmd, args) => {
        capturedArgs = { cmd, args };
        return 'ci output';
      };
      const { client } = await connect(mockCapture);
      const result = await client.callTool({ name: 'ncu_ci', arguments: { pr: '99' } });
      assert.deepStrictEqual(capturedArgs, {
        cmd: 'node',
        args: [GIT_NODE, 'metadata', '--ci', '99']
      });
      assert.strictEqual(result.content[0].text, 'ci output');
    });

    it('should return error content when capture throws', async() => {
      const mockCapture = async() => {
        throw new Error('spawn failed');
      };
      const { client } = await connect(mockCapture);
      const result = await client.callTool({
        name: 'git_node_metadata',
        arguments: { pr: '1' }
      });
      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes('spawn failed'));
    });

    it('should resolve git-node.js path relative to bin/', async() => {
      const { client } = await connect();
      const { tools } = await client.listTools();
      assert.ok(tools.length > 0);
      assert.ok(path.isAbsolute(GIT_NODE));
      assert.ok(GIT_NODE.endsWith(path.join('bin', 'git-node.js')));
    });
  });
});
