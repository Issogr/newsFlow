import { createError } from './errorHandler';

const MAX_HTML_BYTES = 2 * 1024 * 1024;

export async function assertHtmlParseBudget(html: string) {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw createError(422, 'Page is too large to parse safely', 'HTML_TOO_COMPLEX');
  }

  // Count markup starts conservatively, including those inside scripts and comments.
  let markupStarts = 0;
  for (let index = 0; index < html.length; index += 1) {
    if (html[index] === '<' && ++markupStarts > 10_000) {
      throw createError(422, 'Page has too much markup to parse safely', 'HTML_TOO_COMPLEX');
    }
  }

  // HTML repair can clone formatting elements; bound the parsed tree before JSDOM allocates it.
  const { defaultTreeAdapter, Parser, Tokenizer } = await import('parse5');
  class BudgetTokenizer extends Tokenizer {
    protected override _leaveAttrName() {
      // Bound parse5's duplicate-name scan before it processes an entire oversized tag.
      if (this.currentToken && 'attrs' in this.currentToken && this.currentToken.attrs.length >= 256) {
        throw createError(422, 'Tag has too many attributes to parse safely', 'HTML_TOO_COMPLEX');
      }
      super._leaveAttrName();
    }
  }
  let elementCost = 0;
  let attributeBytes = 0;
  let depth = 0;
  const countElementsAndAttributes = (elements: number, attrs: { name: string; value: string }[]) => {
    elementCost += elements + attrs.length;
    if (elementCost > 10_000) {
      throw createError(422, 'Page has too many elements or attributes to parse safely', 'HTML_TOO_COMPLEX');
    }
    for (const attr of attrs) {
      attributeBytes += Buffer.byteLength(attr.name, 'utf8') + Buffer.byteLength(attr.value, 'utf8');
      if (attributeBytes > MAX_HTML_BYTES) {
        throw createError(422, 'Page has too much attribute data to parse safely', 'HTML_TOO_COMPLEX');
      }
    }
  };
  const parser = new Parser({
    scriptingEnabled: false,
    treeAdapter: {
      ...defaultTreeAdapter,
      createElement(tagName, namespaceURI, attrs) {
        countElementsAndAttributes(1, attrs);
        return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs);
      },
      adoptAttributes(recipient, attrs) {
        countElementsAndAttributes(0, attrs);
        defaultTreeAdapter.adoptAttributes(recipient, attrs);
      },
      onItemPush() {
        if (++depth > 128) {
          throw createError(422, 'Page is too deeply nested to parse safely', 'HTML_TOO_COMPLEX');
        }
      },
      onItemPop() {
        depth -= 1;
      }
    } satisfies typeof defaultTreeAdapter
  });
  parser.tokenizer = new BudgetTokenizer(parser.options, parser);
  parser.tokenizer.write(html, true);
}
