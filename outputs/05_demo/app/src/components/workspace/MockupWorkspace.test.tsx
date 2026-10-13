// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockupWorkspace, showScreenInFrame } from './MockupWorkspace';

// The real hook follows the address bar, including history.replaceState; so does this stand-in.
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

const LABELS = ['Request', 'Regulatory team', 'Run board', 'Findings and risks', 'Licensor requests', 'Briefing', 'Architecture'];

beforeEach(() => {
  window.history.replaceState(null, '', '/workspace');
});

const frame = () => screen.getByTitle(/mockup/i) as HTMLIFrameElement;
const tab = (name: string) => screen.getByRole('link', { name });

describe('MockupWorkspace', () => {
  it('offers the seven screens as tabs that link to /workspace?screen=<id>', () => {
    render(<MockupWorkspace showInFrame={vi.fn()} />);

    const nav = screen.getByRole('navigation', { name: 'Mockup screens' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(LABELS);
    expect(tab('Request')).toHaveAttribute('href', '/workspace?screen=request');
    expect(tab('Findings and risks')).toHaveAttribute('href', '/workspace?screen=findings');
    expect(tab('Architecture')).toHaveAttribute('href', '/workspace?screen=architecture');
  });

  it('frames the mockup route in a sandbox that runs its own script but gives it no access to the app', () => {
    render(<MockupWorkspace showInFrame={vi.fn()} />);

    expect(frame().tagName).toBe('IFRAME');
    expect(frame()).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame()).toHaveAttribute('src', '/workspace/mockup#request');
    expect(tab('Request')).toHaveAttribute('aria-current', 'page');
  });

  it('opens the screen a deep link names', () => {
    window.history.replaceState(null, '', '/workspace?screen=findings');

    render(<MockupWorkspace showInFrame={vi.fn()} />);

    expect(frame()).toHaveAttribute('src', '/workspace/mockup#findings');
    expect(tab('Findings and risks')).toHaveAttribute('aria-current', 'page');
    expect(tab('Request')).not.toHaveAttribute('aria-current');
  });

  it('switches the framed mockup in place when a tab is clicked, and puts the screen in the address', () => {
    const showInFrame = vi.fn();
    render(<MockupWorkspace showInFrame={showInFrame} />);

    fireEvent.click(tab('Run board'));

    expect(showInFrame).toHaveBeenCalledTimes(1);
    expect(showInFrame).toHaveBeenCalledWith(frame(), '/workspace/mockup#run');
    expect(tab('Run board')).toHaveAttribute('aria-current', 'page');
    expect(tab('Request')).not.toHaveAttribute('aria-current');
    expect(window.location.pathname + window.location.search).toBe('/workspace?screen=run');
    // In place: the frame keeps its first src, so React never reloads the mockup.
    expect(frame()).toHaveAttribute('src', '/workspace/mockup#request');
  });

  it('switches again when the current tab is clicked, in case the mockup’s own tabs moved away', () => {
    const showInFrame = vi.fn();
    render(<MockupWorkspace showInFrame={showInFrame} />);

    fireEvent.click(tab('Request'));

    expect(showInFrame).toHaveBeenCalledTimes(1);
    expect(showInFrame).toHaveBeenCalledWith(frame(), '/workspace/mockup#request');
  });

  it('leaves a click with a modifier key to the browser (a new tab or window)', () => {
    const showInFrame = vi.fn();
    render(<MockupWorkspace showInFrame={showInFrame} />);
    let preventedByApp: boolean | undefined;
    // Runs after React's handler; it stops jsdom's own navigation once it has looked.
    const stopNavigation = (event: Event) => {
      preventedByApp = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('click', stopNavigation);
    try {
      fireEvent.click(tab('Briefing'), { metaKey: true });
    } finally {
      document.removeEventListener('click', stopNavigation);
    }

    expect(preventedByApp).toBe(false);
    expect(showInFrame).not.toHaveBeenCalled();
    expect(tab('Request')).toHaveAttribute('aria-current', 'page');
  });

  it('follows the address when it changes from outside, such as the rail link back to /workspace', () => {
    const showInFrame = vi.fn();
    window.history.replaceState(null, '', '/workspace?screen=run');
    const { rerender } = render(<MockupWorkspace showInFrame={showInFrame} />);
    expect(showInFrame).not.toHaveBeenCalled();

    window.history.replaceState(null, '', '/workspace');
    rerender(<MockupWorkspace showInFrame={showInFrame} />);

    expect(showInFrame).toHaveBeenCalledTimes(1);
    expect(showInFrame).toHaveBeenCalledWith(frame(), '/workspace/mockup#request');
    expect(tab('Request')).toHaveAttribute('aria-current', 'page');
    expect(tab('Run board')).not.toHaveAttribute('aria-current');
  });
});

describe('showScreenInFrame', () => {
  const fakeFrame = (contentWindow: unknown) => ({ contentWindow, src: '/workspace/mockup#request' }) as unknown as HTMLIFrameElement;

  it('replaces the framed page’s location: no reload and no extra history entry', () => {
    const replace = vi.fn();
    const target = fakeFrame({ location: { replace } });

    showScreenInFrame(target, '/workspace/mockup#run');

    expect(replace).toHaveBeenCalledWith('/workspace/mockup#run');
    expect(target.src).toBe('/workspace/mockup#request');
  });

  it('falls back to the src attribute when the frame has no window yet', () => {
    const target = fakeFrame(null);

    showScreenInFrame(target, '/workspace/mockup#run');

    expect(target.src).toBe('/workspace/mockup#run');
  });

  it('falls back to the src attribute when the browser refuses the location change', () => {
    const target = fakeFrame({
      location: {
        replace: () => {
          throw new Error('blocked');
        },
      },
    });

    showScreenInFrame(target, '/workspace/mockup#run');

    expect(target.src).toBe('/workspace/mockup#run');
  });
});
