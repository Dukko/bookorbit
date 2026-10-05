import { describe, expect, it } from 'vitest';
import { formatDuration, frontmatter, mdTable, slugifyTitle } from './markdown.js';

describe('frontmatter', () => {
  it('renders flow tags', () => {
    const out = frontmatter({ tags: ['bookorbit', 'dashboard'] });
    expect(out).toContain('tags: [bookorbit, dashboard]');
  });

  it('quotes strings that need it', () => {
    const out = frontmatter({ title: 'Read "The Fall": a story' });
    expect(out).toContain('title: "Read \\"The Fall\\": a story"');
  });

  it('renders booleans and numbers untagged', () => {
    const out = frontmatter({ count: 7, ok: true });
    expect(out).toContain('count: 7');
    expect(out).toContain('ok: true');
  });
});

describe('formatDuration', () => {
  it('renders minutes under an hour', () => {
    expect(formatDuration(1500)).toBe('25 min');
  });

  it('renders hours and minutes', () => {
    expect(formatDuration(5400)).toBe('1h 30m');
  });

  it('renders whole hours', () => {
    expect(formatDuration(10800)).toBe('3h');
  });
});

describe('mdTable', () => {
  it('escapes pipes in cells', () => {
    const out = mdTable(['Col'], [['a|b']]);
    expect(out).toContain('| a\\|b |');
  });
});

describe('slugifyTitle', () => {
  it('produces an ASCII slug', () => {
    expect(slugifyTitle('The Left Hand of Darkness')).toBe('The Left Hand of Darkness');
  });

  it('strips illegal filename characters', () => {
    expect(slugifyTitle('Dune: Part 2 / Special')).toBe('Dune Part 2 Special');
  });

  it('falls back to book for empty titles', () => {
    expect(slugifyTitle('!!!')).toBe('book');
  });
});
