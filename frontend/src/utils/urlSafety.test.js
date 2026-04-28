import { describe, expect, test } from 'vitest';
import { getSafeExternalUrl } from './urlSafety';

describe('getSafeExternalUrl', () => {
  test('accepts absolute http and https URLs', () => {
    expect(getSafeExternalUrl('https://example.com/article')).toBe('https://example.com/article');
    expect(getSafeExternalUrl('http://example.com/article')).toBe('http://example.com/article');
  });

  test('rejects relative, protocol-relative, and unsafe URLs', () => {
    expect(getSafeExternalUrl('/api/docs')).toBe('');
    expect(getSafeExternalUrl('//example.com/article')).toBe('');
    expect(getSafeExternalUrl('javascript:alert(1)')).toBe('');
  });
});
