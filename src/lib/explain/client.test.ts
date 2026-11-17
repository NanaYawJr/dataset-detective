import { describe, expect, it } from 'vitest';
import { toBlocks } from './client';

describe('toBlocks', () => {
  it('turns the model text into paragraphs, headings and lists, as text only', () => {
    const text = [
      'The file is usable, but check the dates first.',
      '',
      'What to fix first:',
      '- **Order Date** is read day-first.',
      '- Discount is stored as text.',
      '',
      '## Good to know:',
      '* 1,378 rows.',
      '<script>alert(1)</script>',
    ].join('\n');
    expect(toBlocks(text)).toEqual([
      { kind: 'paragraph', text: 'The file is usable, but check the dates first.' },
      { kind: 'heading', text: 'What to fix first' },
      { kind: 'list', items: ['Order Date is read day-first.', 'Discount is stored as text.'] },
      { kind: 'heading', text: 'Good to know' },
      { kind: 'list', items: ['1,378 rows.'] },
      // Shown as text, never as markup.
      { kind: 'paragraph', text: '<script>alert(1)</script>' },
    ]);
  });
});
