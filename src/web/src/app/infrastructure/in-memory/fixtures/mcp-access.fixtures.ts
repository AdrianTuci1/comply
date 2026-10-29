import { McpAccessSnapshot } from '../../../domain/access/mcp-access';

export const MCP_ACCESS_FIXTURES: McpAccessSnapshot[] = [
  {
    organizationId: 'nordwind',
    deploymentMode: 'managed',
    keys: [
      {
        id: 'key-nw-harness',
        name: 'Production harness',
        prefix: 'sk_mcp_9f2c',
        scopes: ['read', 'evidence:write'],
        status: 'active',
        createdAt: '2026-09-18T08:20:00.000Z',
        lastUsedAt: '2026-10-28T06:40:00.000Z',
      },
      {
        id: 'key-nw-auditor',
        name: 'External auditor',
        prefix: 'sk_mcp_41ab',
        scopes: ['read'],
        status: 'active',
        createdAt: '2026-10-02T13:10:00.000Z',
        lastUsedAt: '2026-10-21T09:05:00.000Z',
      },
      {
        id: 'key-nw-local',
        name: 'Local test',
        prefix: 'sk_mcp_0c11',
        scopes: ['read', 'evidence:write'],
        status: 'revoked',
        createdAt: '2026-08-11T10:30:00.000Z',
        lastUsedAt: '2026-09-01T16:45:00.000Z',
      },
    ],
    domain: {
      token: 'cmpl_nw_7f3a91d4c2b8',
      status: 'verified',
      checkedAt: '2026-10-12T09:30:00.000Z',
    },
  },
  {
    organizationId: 'helios',
    deploymentMode: 'self_hosted',
    keys: [
      {
        id: 'key-he-ops',
        name: 'Operations team',
        prefix: 'sk_mcp_77d1',
        scopes: ['read', 'evidence:write', 'admin'],
        status: 'active',
        createdAt: '2026-10-01T07:45:00.000Z',
        lastUsedAt: '2026-10-27T14:25:00.000Z',
      },
    ],
    domain: {
      token: 'cmpl_he_2b6d08e1f4a9',
      status: 'pending',
      checkedAt: null,
    },
  },
  {
    organizationId: 'studiomic',
    deploymentMode: 'managed',
    keys: [],
    domain: {
      token: 'cmpl_sm_9c4e17a6d3f0',
      status: 'unverified',
      checkedAt: null,
    },
  },
];
