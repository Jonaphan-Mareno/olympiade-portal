import { describe, it, expect } from 'vitest';
import { getAuthRedirect } from '@/lib/supabase/middleware';

// The welcome page is part of the signed-in area: it greets new accounts
// (organiser signups and invite claims) right after signup, so unauthenticated
// visitors must be bounced to the landing page like any other protected page.

describe('getAuthRedirect', () => {
  it('sends unauthenticated visitors away from /welcome', () => {
    expect(getAuthRedirect('/welcome', null)).toBe('/');
  });

  it('sends unauthenticated visitors away from /welcome subpaths', () => {
    expect(getAuthRedirect('/welcome/anything', null)).toBe('/');
  });

  it('lets signed-in users view /welcome', () => {
    expect(getAuthRedirect('/welcome', { id: 'user-1' })).toBeNull();
  });

  it('keeps the existing behaviour for public and protected paths', () => {
    // Signed-in users skip the public landing pages
    expect(getAuthRedirect('/', { id: 'user-1' })).toBe('/dashboard');
    expect(getAuthRedirect('/signup', { id: 'user-1' })).toBe('/dashboard');
    // Signed-out users cannot reach the dashboards
    expect(getAuthRedirect('/dashboard', null)).toBe('/');
    expect(getAuthRedirect('/educator/dashboard', null)).toBe('/');
    expect(getAuthRedirect('/', null)).toBeNull();
  });
});
