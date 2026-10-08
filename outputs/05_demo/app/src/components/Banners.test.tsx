// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PracticeBanner } from './Banners';

describe('PracticeBanner', () => {
  it('in practice mode says that replies come from a stand-in model and must not be presented as real answers', () => {
    render(<PracticeBanner mode="practice" />);

    expect(screen.getByRole('note')).toHaveTextContent(
      'Practice mode: replies come from a stand-in model, not AI. Do not present them as real answers.',
    );
  });

  it('in live mode renders nothing, so live pages look as before', () => {
    const { container } = render(<PracticeBanner mode="live" />);

    expect(container).toBeEmptyDOMElement();
  });
});
