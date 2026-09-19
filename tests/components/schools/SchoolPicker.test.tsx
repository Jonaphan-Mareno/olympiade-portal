import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SchoolPicker from '@/components/schools/SchoolPicker';
import type { PickedSchool } from '@/lib/schools/types';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const HIGH_SCHOOL_SUGGESTIONS = [
  {
    name: 'PRETORIA BOYS HIGH SCHOOL',
    type: 'high_school',
    province: 'Gauteng',
    town: 'PRETORIA',
    externalId: '700401012',
  },
];

function okResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

async function typeQuery(value: string) {
  const input = screen.getByRole('combobox');
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  // Flush the 250ms debounce plus the fetch promise chain. findBy* queries
  // are not usable with fake timers (their polling interval never fires),
  // so assertions after this use synchronous queries.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

// Controlled harness mirroring real form usage: the parent owns the picked
// school, so picking or clearing re-renders the picker with the new value.
function renderControlledPicker(initial: PickedSchool | null) {
  const onChange = vi.fn();
  function PickerHarness() {
    const [picked, setPicked] = useState<PickedSchool | null>(initial);
    return (
      <SchoolPicker
        value={picked}
        onChange={(next) => {
          onChange(next);
          setPicked(next);
        }}
      />
    );
  }
  render(<PickerHarness />);
  return { onChange };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SchoolPicker', () => {
  it('searches high schools by default after the debounce', async () => {
    fetchMock.mockResolvedValue(okResponse(HIGH_SCHOOL_SUGGESTIONS));
    const onChange = vi.fn();

    render(<SchoolPicker value={null} onChange={onChange} />);

    await typeQuery('pretoria boys');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/schools/suggest?q=pretoria%20boys&type=high_school'
    );
    expect(
      screen.getByRole('option', {
        name: /PRETORIA BOYS HIGH SCHOOL/i,
      })
    ).toBeInTheDocument();
  });

  it('does not search while the query is shorter than 2 characters', async () => {
    render(<SchoolPicker value={null} onChange={vi.fn()} />);

    await typeQuery('p');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches universities when the type toggle is switched', async () => {
    fetchMock.mockResolvedValue(
      okResponse([
        {
          name: 'University of Cape Town',
          type: 'university',
          country: 'South Africa',
          externalId: 'uct.ac.za',
        },
      ])
    );
    render(<SchoolPicker value={null} onChange={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'University' }));
    });

    await typeQuery('cape town');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/schools/suggest?q=cape%20town&type=university'
    );
  });

  it('reports a picked school with its external id and hides the input', async () => {
    fetchMock.mockResolvedValue(okResponse(HIGH_SCHOOL_SUGGESTIONS));
    const { onChange } = renderControlledPicker(null);

    await typeQuery('pretoria boys');

    const option = screen.getByRole('option', {
      name: /PRETORIA BOYS HIGH SCHOOL/i,
    });
    await act(async () => {
      fireEvent.click(option);
    });

    expect(onChange).toHaveBeenCalledWith({
      name: 'PRETORIA BOYS HIGH SCHOOL',
      type: 'high_school',
      externalId: '700401012',
    });
    // The search input is replaced by the selected-school chip.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('PRETORIA BOYS HIGH SCHOOL')).toBeInTheDocument();
  });

  it('clears the selection when Change is clicked', () => {
    const { onChange } = renderControlledPicker({
      name: 'University of Cape Town',
      type: 'university',
      externalId: 'uct.ac.za',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('selects the highlighted suggestion with Enter', async () => {
    fetchMock.mockResolvedValue(okResponse(HIGH_SCHOOL_SUGGESTIONS));
    const onChange = vi.fn();

    render(<SchoolPicker value={null} onChange={onChange} />);
    await typeQuery('pretoria boys');

    const input = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onChange).toHaveBeenCalledWith({
      name: 'PRETORIA BOYS HIGH SCHOOL',
      type: 'high_school',
      externalId: '700401012',
    });
  });

  it('shows an error message instead of suggestions when the request fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'unavailable' }),
    } as Response);
    render(<SchoolPicker value={null} onChange={vi.fn()} />);

    await typeQuery('pretoria boys');

    expect(screen.getByText(/Try again/i)).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('shows a no-matches message when the directory has no hits', async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    render(<SchoolPicker value={null} onChange={vi.fn()} />);

    await typeQuery('zzzzzz');

    expect(screen.getByText(/No matches/i)).toBeInTheDocument();
  });
});
