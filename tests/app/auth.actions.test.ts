import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login, logout } from '@/app/auth/actions';
import { createClient } from '@/lib/supabase/server';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`Redirected to ${url}`);
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

const { mockSelect, mockWhere } = vi.hoisted(() => {
  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockSelect, mockWhere };
});

vi.mock('@/lib/db', () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(),
      })),
    })),
  },
}));

describe('Auth Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('returns error if sign in fails', async () => {
      const mockSignInWithPassword = vi.fn().mockResolvedValue({
        error: { message: 'Invalid credentials' },
      });
      (createClient as any).mockResolvedValue({
        auth: { signInWithPassword: mockSignInWithPassword },
      });

      const formData = new FormData();
      formData.append('email', 'test@example.com');
      formData.append('password', 'wrongpassword');

      const result = await login(formData);
      expect(result).toEqual({ error: 'Invalid credentials' });
    });

    it('returns error if user account was deleted from DB (ghost account)', async () => {
      const mockSignInWithPassword = vi.fn().mockResolvedValue({ error: null });
      const mockSignOut = vi.fn();
      (createClient as any).mockResolvedValue({
        auth: { 
          signInWithPassword: mockSignInWithPassword,
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: '123' } } }),
          signOut: mockSignOut,
        },
      });

      // Mock DB: no user profile found
      mockWhere.mockResolvedValueOnce([]);

      const formData = new FormData();
      formData.append('email', 'ghost@example.com');
      formData.append('password', 'password');

      const result = await login(formData);
      expect(result).toEqual({ error: 'This account no longer exists. Please contact the administrator if you believe this is a mistake.' });
      expect(mockSignOut).toHaveBeenCalled();
    });

    it('redirects to dashboard on successful login', async () => {
      const mockSignInWithPassword = vi.fn().mockResolvedValue({ error: null });
      (createClient as any).mockResolvedValue({
        auth: { 
          signInWithPassword: mockSignInWithPassword,
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: '123' } } }),
        },
      });

      // Mock DB: user profile exists
      mockWhere.mockResolvedValueOnce([{ id: '123' }]);

      const formData = new FormData();
      formData.append('email', 'test@example.com');
      formData.append('password', 'password');

      await expect(login(formData)).rejects.toThrow('Redirected to /dashboard');
    });
  });

  describe('logout', () => {
    it('calls signOut and redirects', async () => {
      const mockSignOut = vi.fn();
      (createClient as any).mockResolvedValue({
        auth: { signOut: mockSignOut },
      });

      await expect(logout()).rejects.toThrow('Redirected to /');
      expect(mockSignOut).toHaveBeenCalled();
    });
  });
});
