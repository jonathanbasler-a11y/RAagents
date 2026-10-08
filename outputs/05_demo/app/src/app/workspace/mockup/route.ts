import { serveMockupHtml } from '../_lib/mockup-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** UX mockup v2, served as-is from outputs/05_demo/ux-mockup/index.html for the workspace page's frame. */
export function GET(): Promise<Response> {
  return serveMockupHtml();
}
