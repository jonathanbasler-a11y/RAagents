// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('jsdom test harness', () => {
  it('renders React and provides the jest-dom matchers', () => {
    render(<p>Model output · not sourced</p>);

    expect(screen.getByText('Model output · not sourced')).toBeInTheDocument();
  });

  it('cleans up the DOM after each test', () => {
    expect(document.body).toBeEmptyDOMElement();
  });
});
