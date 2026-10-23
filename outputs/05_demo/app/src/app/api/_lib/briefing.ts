import 'server-only';
import { briefingToMarkdown, buildBriefing } from '@/shared/briefing';
import type { BriefingResponse } from '@/shared/contracts';
import type { ApiDeps } from './deps';
import { currentTeam } from './selection';
import { apiError, json, logFailure } from './http';

// The briefing over HTTP: read-only. It is built fresh from the register, the tags and the checklist on every request
// (nothing is stored), as JSON for the page or as a Markdown download. No model is called and nothing is written.

const FORMATS = ['json', 'markdown'] as const;

/** GET /api/briefing[?format=json|markdown] */
export function getBriefing(request: Request, deps: ApiDeps): Response {
  const correlationId = deps.newId();
  try {
    const formats = new URL(request.url).searchParams.getAll('format');
    if (formats.length > 1 || (formats.length === 1 && !(FORMATS as readonly string[]).includes(formats[0]))) {
      return apiError('invalid_request', correlationId, { message: 'The format must be json or markdown.' });
    }
    const { store, workspaceId } = deps.runtime();
    const briefing = buildBriefing({
      dataRoom: store.getDataRoom(workspaceId),
      findings: store.listFindings(workspaceId),
      tags: store.listFindingTags(workspaceId),
      openQuestions: store.listOpenQuestions(workspaceId),
      checklist: store.listChecklist(workspaceId),
      gates: store.listGates(workspaceId, currentTeam(deps)),
    });
    const generatedAt = deps.now().toISOString();
    if (formats[0] === 'markdown') {
      return new Response(briefingToMarkdown(briefing, generatedAt), {
        status: 200,
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': `attachment; filename="dd-briefing${briefing.asOf === null ? '' : `-${briefing.asOf}`}.md"`,
          'cache-control': 'no-store',
        },
      });
    }
    const body: BriefingResponse = { workspaceId, generatedAt, briefing };
    return json(body);
  } catch (error) {
    logFailure(deps.log, 'GET /api/briefing', correlationId, error);
    return apiError('internal', correlationId);
  }
}
