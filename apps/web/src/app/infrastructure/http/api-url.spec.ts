import { apiAbsoluteUrl, apiUrl } from './api-url';

describe('apiUrl', () => {
  beforeEach(() => {
    globalThis.COMPLY_CONFIG = undefined;
  });

  it('keeps relative paths when no runtime config is loaded', () => {
    expect(apiUrl('/api/library')).toBe('/api/library');
  });

  it('keeps relative paths when apiBase is empty', () => {
    globalThis.COMPLY_CONFIG = { apiBase: '' };
    expect(apiUrl('/api/library')).toBe('/api/library');
  });

  it('joins a base without duplicating slashes', () => {
    globalThis.COMPLY_CONFIG = { apiBase: 'https://comply-api.example.com/' };
    expect(apiUrl('/api/library')).toBe('https://comply-api.example.com/api/library');
  });

  it('keeps a path prefix on the base', () => {
    globalThis.COMPLY_CONFIG = { apiBase: 'https://comply-api.example.com/gateway' };
    expect(apiUrl('/api/library')).toBe('https://comply-api.example.com/gateway/api/library');
  });

  it('trims whitespace and repeated trailing slashes from the base', () => {
    globalThis.COMPLY_CONFIG = { apiBase: '  https://comply-api.example.com///  ' };
    expect(apiUrl('/api/library')).toBe('https://comply-api.example.com/api/library');
  });

  it('leaves an already absolute path untouched', () => {
    globalThis.COMPLY_CONFIG = { apiBase: 'https://comply-api.example.com' };
    expect(apiUrl('https://other.example.com/api/library')).toBe(
      'https://other.example.com/api/library',
    );
    expect(apiUrl('http://localhost:4300/api/library')).toBe('http://localhost:4300/api/library');
  });

  it('keeps query strings intact', () => {
    expect(apiUrl('/api/library?limit=25&offset=50')).toBe('/api/library?limit=25&offset=50');

    globalThis.COMPLY_CONFIG = { apiBase: 'https://comply-api.example.com/' };
    expect(apiUrl('/api/library?limit=25&offset=50')).toBe(
      'https://comply-api.example.com/api/library?limit=25&offset=50',
    );
  });

  it('normalizes a path without a leading slash', () => {
    globalThis.COMPLY_CONFIG = { apiBase: 'https://comply-api.example.com' };
    expect(apiUrl('api/library')).toBe('https://comply-api.example.com/api/library');
  });
});

describe('apiAbsoluteUrl', () => {
  beforeEach(() => {
    globalThis.COMPLY_CONFIG = undefined;
  });

  it('resolves against the configured base for browser navigation', () => {
    globalThis.COMPLY_CONFIG = { apiBase: 'https://comply-api.example.com/' };
    expect(apiAbsoluteUrl('/api/auth/oidc/github/start')).toBe(
      'https://comply-api.example.com/api/auth/oidc/github/start',
    );
  });

  it('falls back to the current origin without a base', () => {
    expect(apiAbsoluteUrl('/api/auth/oidc/github/start')).toBe(
      `${globalThis.location.origin}/api/auth/oidc/github/start`,
    );
  });

  it('leaves an already absolute path untouched', () => {
    globalThis.COMPLY_CONFIG = { apiBase: 'https://comply-api.example.com' };
    expect(apiAbsoluteUrl('https://other.example.com/api/auth/start')).toBe(
      'https://other.example.com/api/auth/start',
    );
  });
});
