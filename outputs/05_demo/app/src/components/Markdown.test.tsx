// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

describe('Markdown', () => {
  it('renders links as plain text, never as anchors', () => {
    const { container } = render(
      <Markdown text={'See [the guidance](https://example.org/guide) and https://example.org/raw for more.'} />,
    );

    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('See the guidance and https://example.org/raw for more.');
  });

  it('drops images entirely', () => {
    const { container } = render(<Markdown text={'Before ![a chart](https://example.org/chart.png) after'} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container).not.toHaveTextContent('a chart');
    expect(container).toHaveTextContent('Before after');
  });

  it('skips raw HTML instead of rendering it', () => {
    const { container } = render(
      <Markdown text={'Plain <b>bold</b> text.\n\n<div onclick="steal()">block</div>\n\n<img src="x.png">'} />,
    );

    expect(container.querySelector('b, div[onclick], img')).toBeNull();
    expect(container).toHaveTextContent('Plain bold text.');
  });

  it('keeps a footnote readable: its label is for screen readers only, with no dangling back-link and no repeated ids', () => {
    const text = 'Company statements are claims.[^1]\n\n[^1]: To verify against the public review.';
    const { container } = render(
      <>
        <Markdown text={text} />
        <Markdown text={text} />
      </>,
    );

    const labels = [...container.querySelectorAll('.md section h2')];
    expect(labels.map((label) => label.textContent)).toEqual(['Footnotes', 'Footnotes']);
    for (const label of labels) expect(label).toHaveClass('visually-hidden');
    expect(container.querySelectorAll('[id]')).toHaveLength(0);
    expect(container).not.toHaveTextContent('↩');
    expect(container).toHaveTextContent('To verify against the public review.');
  });

  it('renders GitHub-flavoured tables and lists', () => {
    render(<Markdown text={'| Check | Owner |\n|---|---|\n| Designation | RA lead |\n\n- one\n- two'} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Designation' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
