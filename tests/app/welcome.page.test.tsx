import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import WelcomePage from '@/app/welcome/page';

// The welcome page greets every fresh account (organiser signups and invite
// claims alike) before sending them on to the ?next= target. It must only
// allow in-app targets, and bounce signed-out visitors to the landing page.

const h = vi.hoisted(() => {
  const state = {
    // Queued row arrays, one per select() the page performs
    selectRows: [] as any[][],
    redirectCalls: [] as string[],
    authUser: null as {
      id: string;
      email?: string;
      user_metadata?: any;
    } | null,
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.selectRows.shift() ?? []),
        innerJoin: () => ({
          where: () => Promise.resolve(state.selectRows.shift() ?? []),
        }),
      }),
    }),
  };

  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: state.authUser }, error: null }),
    },
  };

  return { state, db, supabase };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    h.state.redirectCalls.push(path);
    throw new Error(`Redirected to ${path}`);
  },
}));
vi.mock('next/image', () => ({
  default: (props: any) => <img {...props} alt={props.alt} />,
}));
vi.mock('@/app/organiser/SignOutButton', () => ({
  default: () => <button type="button">Sign Out</button>,
}));

function renderPage(next?: string) {
  // searchParams is a Promise in Next 16 server components
  return WelcomePage({ searchParams: Promise.resolve({ next }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.selectRows = [];
  h.state.redirectCalls = [];
  h.state.authUser = null;
});

describe('WelcomePage', () => {
  it('redirects signed-out visitors to the landing page', async () => {
    h.state.authUser = null;

    await expect(renderPage('/dashboard')).rejects.toThrow('Redirected to /');
    expect(h.state.redirectCalls).toEqual(['/']);
  });

  it('greets a fresh organiser account and links to the dashboard', async () => {
    h.state.authUser = { id: 'user-new', email: 'solo@example.com' };
    h.state.selectRows = [
      [{ id: 'user-new', name: 'Ada Lovelace', email: 'solo@example.com' }], // profile
      [], // no accepted memberships yet
    ];

    const page = await renderPage();
    render(page);

    expect(screen.getByText('Welcome to Olympia, Ada!')).toBeInTheDocument();
    expect(screen.getByText(/your account is ready/i)).toBeInTheDocument();
    // Plain signups are pointed at the organiser application flow
    expect(
      screen.getByText(/complete your organiser application/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get Started' })).toHaveAttribute(
      'href',
      '/dashboard'
    );
  });

  it('lists the olympiads joined by a claimed invite account', async () => {
    h.state.authUser = { id: 'user-claim', email: 'jon@teacher.com' };
    h.state.selectRows = [
      [{ id: 'user-claim', name: 'Jon Teacher', email: 'jon@teacher.com' }],
      [
        { portalName: 'Maths Olympiad', role: 'educator' },
        { portalName: 'Science Olympiad', role: 'student' },
      ],
    ];

    const page = await renderPage('/educator?portalId=portal-A');
    render(page);

    expect(screen.getByText('Welcome to Olympia, Jon!')).toBeInTheDocument();
    expect(screen.getByText(/Maths Olympiad/)).toBeInTheDocument();
    expect(screen.getByText(/Science Olympiad/)).toBeInTheDocument();
    // Educator guidance wins over student guidance
    expect(screen.getByText(/educator portal/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get Started' })).toHaveAttribute(
      'href',
      '/educator?portalId=portal-A'
    );
  });

  it('falls back to /dashboard for unsafe next targets (open-redirect guard)', async () => {
    h.state.authUser = { id: 'user-new', email: 'solo@example.com' };
    h.state.selectRows = [
      [{ id: 'user-new', name: 'Ada', email: 'solo@example.com' }],
      [],
    ];

    const external = await renderPage('https://evil.example.com');
    render(external);
    expect(screen.getByRole('link', { name: 'Get Started' })).toHaveAttribute(
      'href',
      '/dashboard'
    );

    const protocolRelative = await renderPage('//evil.example.com');
    render(protocolRelative);
    const links = screen.getAllByRole('link', { name: 'Get Started' });
    expect(links).toHaveLength(2);
    links.forEach((link) => expect(link).toHaveAttribute('href', '/dashboard'));
  });
});
