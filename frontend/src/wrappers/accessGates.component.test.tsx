import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminGate from './AdminGate';
import ParticipantGate from './ParticipantGate';

vi.mock('@umijs/max', () => ({
  Outlet: () => <div>Nested route outlet</div>,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ParticipantGate', () => {
  it('renders the nested Umi route after participant access is accepted', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true }), { status: 200 }));

    render(<ParticipantGate>{undefined}</ParticipantGate>);

    expect(await screen.findByText('Nested route outlet')).toBeInTheDocument();
  });

  it('requires all bilingual consent checks before entering study mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ mode: 'study', authenticated: false, consent_required: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true }), { status: 200 }));

    render(<ParticipantGate><div>Product interface</div></ParticipantGate>);

    expect(await screen.findByRole('heading', { name: /Consent Form/ })).toBeInTheDocument();
    expect(screen.queryByText('Product interface')).not.toBeInTheDocument();
    const continueButton = screen.getByRole('button', { name: /Agree and continue/ });
    expect(continueButton).toBeDisabled();
    screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox));
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    await waitFor(() => expect(screen.getByText('Product interface')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/participant/consent', expect.objectContaining({ method: 'POST' }));
  });
});

describe('AdminGate', () => {
  it('renders the nested Umi route after administrator access is accepted', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true }), { status: 200 }));

    render(<AdminGate>{undefined}</AdminGate>);

    expect(await screen.findByText('Nested route outlet')).toBeInTheDocument();
  });

  it('keeps om content hidden until the password is accepted', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: false }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true }), { status: 200 }));

    render(<AdminGate><div>Admin content</div></AdminGate>);

    expect(await screen.findByRole('heading', { name: /Administrator access/ })).toBeInTheDocument();
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Admin content')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/login', expect.objectContaining({ method: 'POST' }));
  });
});
