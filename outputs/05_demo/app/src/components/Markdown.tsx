import ReactMarkdown, { type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown for model output (and spec text). Deliberately narrow:
 * - raw HTML is skipped, never rendered;
 * - links become their plain text: a model-written URL must not look like a checked source;
 * - images are dropped;
 * - no URL survives into an attribute (urlTransform removes them all);
 * - no element ids: model text links nowhere, and every bubble would repeat the same ids;
 * - a footnote keeps its text, its "Footnotes" label is for screen readers only, and the
 *   back-link arrow (a link, so dropped anyway) leaves no stray "↩".
 */
const DROPPED = ['a', 'img'];
const NO_URLS = () => null;

const FOOTNOTES: NonNullable<Options['remarkRehypeOptions']> = {
  footnoteLabelProperties: { className: ['visually-hidden'] },
  footnoteBackContent: () => [],
};

interface HtmlNode {
  type: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
}

/** A rehype plugin that removes every element id. */
function withoutIds() {
  const strip = (node: HtmlNode) => {
    if (node.type === 'element' && node.properties) delete node.properties.id;
    node.children?.forEach(strip);
  };
  return strip;
}

const REHYPE_PLUGINS: NonNullable<Options['rehypePlugins']> = [withoutIds];

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={FOOTNOTES}
        rehypePlugins={REHYPE_PLUGINS}
        skipHtml
        disallowedElements={DROPPED}
        unwrapDisallowed
        urlTransform={NO_URLS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
