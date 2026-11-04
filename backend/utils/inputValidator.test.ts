import { performance } from 'node:perf_hooks';
import inputValidator from './inputValidator';

const { sanitizeHtml, sanitizeUsername } = inputValidator;

test('keeps username aliases but rejects oversized or non-string input before cleanup', () => {
  expect(sanitizeUsername(' Alice<tag> ')).toBe('Alice');
  expect(sanitizeUsername(`${'a'.repeat(40)}suffix`)).toBe('a'.repeat(40));
  for (const value of [null, 123, {}, '<'.repeat(64_000)]) {
    expect(() => sanitizeUsername(value)).toThrow(expect.objectContaining({ code: 'INVALID_USERNAME', status: 400 }));
  }
});

test('removes markup and script/style contents while decoding article text', () => {
  expect(sanitizeHtml('Before <SCRIPT type="text/javascript">bad <style>nested</style></SCRIPT><p>A &amp; B</p><style>bad</style> after'))
    .toBe('Before A & B after');
  expect(sanitizeHtml('Visible<script>unclosed content')).toBe('Visible');
  expect(sanitizeHtml(null)).toBe('');
});

test('handles repeated malformed markup without quadratic scanning', () => {
  const malformed = '<'.repeat(64_000);
  const start = performance.now();
  expect(sanitizeHtml(malformed)).toBe(malformed);
  expect(sanitizeHtml('<script>'.repeat(8_000))).toBe('');
  expect(performance.now() - start).toBeLessThan(1000);
});
