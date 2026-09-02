import { describe, it, expect, vi, beforeEach } from 'vitest';

const cloudinaryMocks = vi.hoisted(() => ({
  apiSignRequest: vi.fn(() => 'signed-abc123'),
  isCloudinaryConfigured: true,
  apiKey: 'test-api-key',
  apiSecret: 'test-api-secret',
  cloudName: 'test-cloud',
  uploadFolder: 'system1/products',
}));

vi.mock('../../src/config/cloudinary.js', () => ({
  default: { utils: { api_sign_request: (...args) => cloudinaryMocks.apiSignRequest(...args) } },
  get isCloudinaryConfigured() { return cloudinaryMocks.isCloudinaryConfigured; },
  get apiKey() { return cloudinaryMocks.apiKey; },
  get apiSecret() { return cloudinaryMocks.apiSecret; },
  get cloudName() { return cloudinaryMocks.cloudName; },
  get uploadFolder() { return cloudinaryMocks.uploadFolder; },
}));

// Re-imported fresh per test group below since the module reads the mocked
// getters at call time (not at import time), so no need to reset modules.
const { getUploadSignature } = await import('../../src/services/upload.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  cloudinaryMocks.isCloudinaryConfigured = true;
});

describe('getUploadSignature', () => {
  it('throws a clear, non-crashing error when Cloudinary is not configured', () => {
    cloudinaryMocks.isCloudinaryConfigured = false;
    expect(() => getUploadSignature()).toThrowError();
    try {
      getUploadSignature();
    } catch (err) {
      expect(err.statusCode).toBe(503);
      expect(err.details).toMatchObject({ code: 'CLOUDINARY_NOT_CONFIGURED' });
    }
  });

  it('signs exactly {timestamp, folder} — nothing else — matching what the frontend must send', () => {
    getUploadSignature();
    const [paramsToSign, secret] = cloudinaryMocks.apiSignRequest.mock.calls[0];
    expect(Object.keys(paramsToSign).sort()).toEqual(['folder', 'timestamp']);
    expect(paramsToSign.folder).toBe('system1/products');
    expect(secret).toBe('test-api-secret');
  });

  it('returns everything the frontend needs to upload directly to Cloudinary', () => {
    const result = getUploadSignature();
    expect(result).toEqual({
      signature: 'signed-abc123',
      timestamp: expect.any(Number),
      folder: 'system1/products',
      apiKey: 'test-api-key',
      cloudName: 'test-cloud',
    });
  });

  it('never includes the api secret in its return value', () => {
    const result = getUploadSignature();
    expect(JSON.stringify(result)).not.toContain('test-api-secret');
  });

  it('uses a fresh, current timestamp (seconds, not milliseconds)', () => {
    const before = Math.round(Date.now() / 1000);
    const result = getUploadSignature();
    const after = Math.round(Date.now() / 1000);
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });
});
