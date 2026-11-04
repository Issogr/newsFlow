import { performance } from 'node:perf_hooks';
import { assertHtmlParseBudget } from './htmlSafety';

test('bounds markup complexity independently of response bytes', async () => {
  await expect(assertHtmlParseBudget('<br>'.repeat(9_990))).resolves.toBeUndefined();
  await expect(assertHtmlParseBudget('<br>'.repeat(10_001)))
    .rejects.toMatchObject({ code: 'HTML_TOO_COMPLEX' });
});

test('rejects repaired markup that expands into many more elements than its source', async () => {
  const html = '<p>' + Array.from({ length: 100 }, (_, index) => `<b title="${index}">`).join('')
    + '</p>' + '<p>x</p>'.repeat(100);
  await expect(assertHtmlParseBudget(html)).rejects.toMatchObject({ code: 'HTML_TOO_COMPLEX' });
});

test.each(['x', '&', 'é'])('bounds attribute bytes copied by HTML repair (%s)', async (character) => {
  const html = `<p><b title="${character.repeat(64 * 1024)}">start</p>`;
  await expect(assertHtmlParseBudget(html)).resolves.toBeUndefined();
  await expect(assertHtmlParseBudget(html + '<p>paragraph</p>'.repeat(40))).rejects.toMatchObject({
    code: 'HTML_TOO_COMPLEX', message: 'Page has too much attribute data to parse safely'
  });
});

test('rejects deep nesting before constructing a browser document', async () => {
  await expect(assertHtmlParseBudget('<div>'.repeat(130)))
    .rejects.toMatchObject({ code: 'HTML_TOO_COMPLEX' });
});

test('enforces the byte budget on multibyte text and permits large simple pages', async () => {
  await expect(assertHtmlParseBudget(`<p>${'x'.repeat(1024 * 1024)}</p>`)).resolves.toBeUndefined();
  await expect(assertHtmlParseBudget('é'.repeat(1024 * 1024 + 1)))
    .rejects.toMatchObject({ code: 'HTML_TOO_COMPLEX' });
});

test.each(['>', ''])('rejects oversized attribute lists before the whole tag is read (ending: %s)', async (ending) => {
  await assertHtmlParseBudget('<p>Warm up the parser import</p>');
  const html = '<div' + Array.from({ length: 50_000 }, (_, index) => ` a${index}=">"`).join('') + ending;
  const start = performance.now();
  await expect(assertHtmlParseBudget(html)).rejects.toMatchObject({
    code: 'HTML_TOO_COMPLEX', message: 'Tag has too many attributes to parse safely'
  });
  expect(performance.now() - start).toBeLessThan(1000);
});

test('allows ordinary quoted markup and up to 256 attributes per tag', async () => {
  const attributes = Array.from({ length: 256 }, (_, index) => ` a${index}="< > '"`).join('');
  await expect(assertHtmlParseBudget(`<div${attributes}>Text</div>`)).resolves.toBeUndefined();
  await expect(assertHtmlParseBudget(`<div${attributes} extra>`)).rejects.toMatchObject({ code: 'HTML_TOO_COMPLEX' });
});

test.each(['body', 'html'])('counts attributes adopted from repeated %s tags', async (tag) => {
  const html = '<html><body>' + Array.from({ length: 100 }, (_, batch) =>
    `<${tag}${Array.from({ length: 100 }, (_, index) => ` a${batch}_${index}="x"`).join('')}>`
  ).join('');
  await expect(assertHtmlParseBudget(html)).rejects.toMatchObject({
    code: 'HTML_TOO_COMPLEX', message: 'Page has too many elements or attributes to parse safely'
  });
});
