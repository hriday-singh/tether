import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from './markdown-preview';

describe('MarkdownPreview', () => {
  it('renders placeholder when empty', () => {
    render(<MarkdownPreview content="" />);
    expect(screen.getByText('Markdown Preview')).toBeInTheDocument();
  });

  it('renders headings and paragraphs', () => {
    const markdown = '# Main Heading\n\nThis is a paragraph with **bold** text.';
    render(<MarkdownPreview content={markdown} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Main Heading');
    expect(screen.getByText(/This is a paragraph with/)).toBeInTheDocument();
  });

  it('renders tables and task lists', () => {
    const markdown = `
| Header 1 | Header 2 |
| -------- | -------- |
| Value 1  | Value 2  |

- [x] Task 1
- [ ] Task 2
`;
    const { container } = render(<MarkdownPreview content={markdown} />);
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it('strips unsafe script tags from rendered output', () => {
    const malicious = '# Title\n<script>alert("hacked")</script>\nSafe text';
    const { container } = render(<MarkdownPreview content={malicious} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('Safe text');
  });

  it('neutralizes dangerous javascript: URLs and embedded iframes', () => {
    const malicious = '# Title\n[Bad](javascript:alert(1))\n<iframe src="https://evil.com"></iframe>';
    const { container } = render(<MarkdownPreview content={malicious} />);
    expect(container.querySelector('iframe')).toBeNull();
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('#');
  });

  it('applies zoom in style on the content container', () => {
    const markdown = '# Scaled Heading\nContent';
    const { container } = render(<MarkdownPreview content={markdown} zoom={1.5} />);
    const innerWrapper = container.querySelector('.min-h-full');
    expect(innerWrapper).toHaveStyle({ zoom: '1.5' });
  });

  it('applies zoom out and compensates maxWidth so document does not shrink inward', () => {
    const markdown = '# Overview\nLong document';
    const { container } = render(<MarkdownPreview content={markdown} zoom={0.5} />);
    const innerWrapper = container.querySelector('.min-h-full');
    expect(innerWrapper).toHaveStyle({ zoom: '0.5' });
    const article = container.querySelector('article');
    expect(article?.style.maxWidth).toBe('96rem');
  });
});
