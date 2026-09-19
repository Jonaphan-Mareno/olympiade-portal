import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PendingButton } from '@/components/ui/PendingButton';

describe('PendingButton', () => {
  it('renders children and fires onClick when idle', () => {
    const onClick = vi.fn();
    render(<PendingButton onClick={onClick}>Sign Out</PendingButton>);

    const button = screen.getByRole('button', { name: 'Sign Out' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-busy', 'false');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner and pending text while the handler runs, then recovers', async () => {
    let resolveHandler: (() => void) | undefined;
    const onClick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveHandler = resolve;
        })
    );
    render(
      <PendingButton onClick={onClick} pendingText="Signing Out…">
        Sign Out
      </PendingButton>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));

    const pendingButton = screen.getByRole('button', { name: 'Signing Out…' });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.queryByText('Sign Out')).not.toBeInTheDocument();

    await act(async () => {
      resolveHandler?.();
    });

    const restoredButton = screen.getByRole('button', { name: 'Sign Out' });
    expect(restoredButton).toBeEnabled();
    expect(restoredButton).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  });

  it('ignores a second click while the handler is still running', () => {
    const onClick = vi.fn(() => new Promise<void>(() => {}));
    render(<PendingButton onClick={onClick}>Save</PendingButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('does not enter pending state for synchronous handlers', () => {
    const onClick = vi.fn(() => 'ignored return value');
    render(<PendingButton onClick={onClick}>Click Me</PendingButton>);

    const button = screen.getByRole('button', { name: 'Click Me' });
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button).toBeEnabled();
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  });

  it('respects an external pending flag without invoking onClick', () => {
    const onClick = vi.fn();
    render(
      <PendingButton onClick={onClick} pending pendingText="Working…">
        Go
      </PendingButton>
    );

    const button = screen.getByRole('button', { name: 'Working…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('spinner')).toBeInTheDocument();

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('never fires onClick for a disabled button', () => {
    const onClick = vi.fn();
    render(
      <PendingButton onClick={onClick} disabled>
        Locked
      </PendingButton>
    );

    const button = screen.getByRole('button', { name: 'Locked' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
