import assert from 'node:assert/strict';
import test from 'node:test';
import { createLlmEndpointValidator, isPrivateAddress, parseAllowedHosts } from './llmEndpointPolicy.mjs';

const publicLookup = async () => [{ address: '203.0.113.10' }];

test('parseAllowedHosts normalizes and drops empty entries', () => {
  assert.deepEqual([...parseAllowedHosts(' API.Example.Org, ,api2.example.org ')], ['api.example.org', 'api2.example.org']);
});

test('validateLlmEndpoint accepts allowed HTTPS public endpoints', async () => {
  const validate = createLlmEndpointValidator({
    allowedHosts: parseAllowedHosts('api.example.org'),
    lookup: publicLookup,
  });

  await assert.doesNotReject(() => validate('https://api.example.org/v1'));
});

test('validateLlmEndpoint rejects HTTP unless explicitly enabled', async () => {
  const validate = createLlmEndpointValidator({
    allowedHosts: parseAllowedHosts('api.example.org'),
    lookup: publicLookup,
  });

  await assert.rejects(() => validate('http://api.example.org/v1'), /must use https/);
});

test('validateLlmEndpoint allows HTTP only when local dev flag is enabled', async () => {
  const validate = createLlmEndpointValidator({
    allowedHosts: parseAllowedHosts('api.example.org'),
    allowHttpEndpoints: true,
    lookup: publicLookup,
  });

  await assert.doesNotReject(() => validate('http://api.example.org/v1'));
});

test('validateLlmEndpoint rejects hosts outside the allowlist', async () => {
  const validate = createLlmEndpointValidator({
    allowedHosts: parseAllowedHosts('api.example.org'),
    lookup: publicLookup,
  });

  await assert.rejects(() => validate('https://evil.example.org/v1'), /not allowed/);
});

test('validateLlmEndpoint rejects private DNS results by default', async () => {
  const validate = createLlmEndpointValidator({
    allowedHosts: parseAllowedHosts('api.example.org'),
    lookup: async () => [{ address: '10.0.0.12' }],
  });

  await assert.rejects(() => validate('https://api.example.org/v1'), /private or loopback/);
});

test('validateLlmEndpoint can allow private endpoints when explicitly configured', async () => {
  const validate = createLlmEndpointValidator({
    allowedHosts: parseAllowedHosts('api.example.org'),
    allowPrivateEndpoints: true,
    lookup: async () => [{ address: '10.0.0.12' }],
  });

  await assert.doesNotReject(() => validate('https://api.example.org/v1'));
});

test('isPrivateAddress covers loopback, RFC1918, link-local, CGNAT, and ULA ranges', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.2', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', 'fd00::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }

  assert.equal(isPrivateAddress('203.0.113.10'), false);
});
