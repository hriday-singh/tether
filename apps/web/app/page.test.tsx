import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

describe('LandingPage', () => {
  it('renders repository links with correct target and URL', () => {
    render(<LandingPage />);

    // Header github button link
    const headerGithubLink = screen.getByRole('link', { name: /source on github/i });
    expect(headerGithubLink).toHaveAttribute('href', 'https://github.com/hriday-singh/tether');
    expect(headerGithubLink).toHaveAttribute('target', '_blank');
    expect(headerGithubLink).toHaveAttribute('rel', 'noreferrer');

    // Footer repository link
    const footerRepoLink = screen.getByRole('link', { name: /^repository$/i });
    expect(footerRepoLink).toHaveAttribute('href', 'https://github.com/hriday-singh/tether');
    expect(footerRepoLink).toHaveAttribute('target', '_blank');
    expect(footerRepoLink).toHaveAttribute('rel', 'noreferrer');

    // Footer architecture link
    const footerArchLink = screen.getByRole('link', { name: /^architecture$/i });
    expect(footerArchLink).toHaveAttribute('href', 'https://github.com/hriday-singh/tether#system-architecture');
    expect(footerArchLink).toHaveAttribute('target', '_blank');
    expect(footerArchLink).toHaveAttribute('rel', 'noreferrer');
  });
});
