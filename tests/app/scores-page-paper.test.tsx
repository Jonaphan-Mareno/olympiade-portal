import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

// The student's results page for a PAPER script: the marked script the school
// uploaded replaces the old "not available" placeholder, but only once results
// are published; without a script the mark and the appeal are still shown.

const h = vi.hoisted(() => ({
  selectRows: [] as any[][],
  pages: [] as any[],
  getScriptPages: vi.fn(),
  getRoundMemo: vi.fn(),
  remarkProps: null as any,
  viewerSets: null as any,
}));

vi.mock('@/lib/db', () => {
  const chain = (): any => {
    const node: any = {
      where: () => {
        const p: any = Promise.resolve(h.selectRows.shift() ?? []);
        p.limit = () => p;
        return p;
      },
      limit: () => node,
    };
    node.leftJoin = () => chain();
    node.innerJoin = () => chain();
    return node;
  };
  return { db: { select: () => ({ from: () => chain() }) } };
});
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
  }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND'); },
  redirect: () => { throw new Error('REDIRECT'); },
}));
vi.mock('@/domain/scripts/script-pages', () => ({
  getScriptPages: h.getScriptPages,
}));
vi.mock('@/domain/memo/round-memo', () => ({
  getRoundMemo: h.getRoundMemo,
}));
vi.mock('@/components/scripts/MemoPanel', () => ({
  default: (props: any) => <div data-testid="memo-panel">{props.entries.length} memo entries</div>,
}));
vi.mock('@/domain/rounds/score-percentage', () => ({
  getRoundTotalMarks: async () => new Map([['round-1', 50]]),
  formatScoreDisplay: (score: string, total: number) => `${score} / ${total}`,
}));
vi.mock('@/components/scripts/ScriptViewer', () => ({
  default: (props: any) => {
    h.viewerSets = props.sets;
    return <div data-testid="script-viewer" />;
  },
}));
vi.mock('@/app/(student)/results/scores/[submissionId]/RemarkSection', () => ({
  default: (props: any) => {
    h.remarkProps = props;
    return <div data-testid="remark-section" />;
  },
}));

import ScoresPage from '@/app/(student)/results/scores/[submissionId]/page';

function subData(resultsPublishedAt: Date | null) {
  return [{
    submission: { id: 'sub-1', roundId: 'round-1', studentMembershipId: 'm-1', submissionType: 'offline' },
    result: { score: '31' },
    roundName: 'Round 1',
    roundId: 'round-1',
    resultsPublishedAt,
    portalName: 'Maths Olympiad',
  }];
}

async function renderPage() {
  render(await ScoresPage({ params: Promise.resolve({ submissionId: 'sub-1' }) }));
}

beforeEach(() => {
  h.selectRows = [];
  h.remarkProps = null;
  h.viewerSets = null;
  h.getScriptPages.mockReset();
  h.getRoundMemo.mockReset();
  h.getRoundMemo.mockResolvedValue({ entries: [{ number: 1 }, { number: 2 }], hasUploadedMemo: false });
});

describe('ScoresPage — paper scripts', () => {
  it('does not load or show the script before results are published', async () => {
    h.selectRows = [subData(null), []];
    await renderPage();
    expect(h.getScriptPages).not.toHaveBeenCalled();
    expect(screen.getByText(/available here once results are published/)).toBeInTheDocument();
    expect(screen.queryByTestId('script-viewer')).toBeNull();
    expect(h.getRoundMemo).not.toHaveBeenCalled();
    expect(screen.queryByTestId('memo-panel')).toBeNull();
  });

  it('says the school has not uploaded it yet, and still allows a reason-only appeal', async () => {
    h.selectRows = [subData(new Date('2026-09-12T09:00:00Z')), []];
    h.getScriptPages.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText(/hasn.t uploaded your marked script yet/)).toBeInTheDocument();
    expect(screen.getByText(/31 \/ 50/)).toBeInTheDocument();
    expect(h.remarkProps.paperPageIds).toEqual([]);
    expect(h.remarkProps.eligibility.eligible).toBeDefined();
  });

  it('shows the original pages with the appeal’s pins, and re-marked pages once resolved', async () => {
    const pins = [{ page: 0, x: 0.1, y: 0.2, note: 'Q3' }];
    h.selectRows = [
      subData(new Date('2026-09-12T09:00:00Z')),
      [{ id: 'remark-1', status: 'resolved', reason: 'r', pins, questionRefs: 'Q3' }],
    ];
    h.getScriptPages.mockResolvedValue([
      { id: 'p0', kind: 'original', remarkRequestId: null, pageIndex: 0 },
      { id: 'p1', kind: 'original', remarkRequestId: null, pageIndex: 1 },
      { id: 'r0', kind: 'remarked', remarkRequestId: 'remark-1', pageIndex: 0 },
    ]);
    await renderPage();
    expect(h.getScriptPages).toHaveBeenCalledWith('sub-1');
    expect(h.viewerSets).toEqual([
      { key: 'original', label: 'Original', pageIds: ['p0', 'p1'], pins },
      { key: 'remarked', label: 'After remark', pageIds: ['r0'] },
    ]);
    expect(h.remarkProps.paperPageIds).toEqual(['p0', 'p1']);
    // The memo sits beside the script
    expect(h.getRoundMemo).toHaveBeenCalledWith('round-1');
    expect(screen.getByTestId('memo-panel')).toHaveTextContent('2 memo entries');
  });

  it('still shows the memo when no script was uploaded', async () => {
    h.selectRows = [subData(new Date('2026-09-12T09:00:00Z')), []];
    h.getScriptPages.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByTestId('memo-panel')).toBeInTheDocument();
  });
});
