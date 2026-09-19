import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

function renderDialog(props: Partial<ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <ConfirmDialog
      open
      title="Delete this Olympiad?"
      description="This action cannot be undone."
      confirmLabel="Delete Olympiad"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onConfirm, onCancel, ...utils };
}

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders title, description and action buttons when open', () => {
    renderDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete this Olympiad?')).toBeInTheDocument();
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete Olympiad' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Olympiad' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels via the Escape key and a backdrop click', () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('focuses the cancel button when opened', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('traps Tab focus between the two buttons', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete Olympiad' });

    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(cancel).toHaveFocus();
  });

  it('locks body scroll while open and restores it on close', () => {
    const { unmount } = renderDialog();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('renders the confirm button in red for the danger tone', () => {
    renderDialog({ tone: 'danger' });
    expect(screen.getByRole('button', { name: 'Delete Olympiad' }).className).toContain(
      'bg-red-600'
    );
  });

  it('shows a spinner and blocks every dismissal route while busy', () => {
    const { onConfirm, onCancel } = renderDialog({
      busy: true,
      busyLabel: 'Deleting…',
    });

    const confirmButton = screen.getByRole('button', { name: 'Deleting…' });
    expect(confirmButton).toBeDisabled();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    // Neither Escape nor the backdrop may dismiss a running action.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
