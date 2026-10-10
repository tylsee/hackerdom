import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditableOutline } from '../src/components/EditableOutline';
import { initialWizard } from '../src/data';
import { headingsFromText, outlineFromContext } from '../src/utils/outline';
import { packPages, splitSectionHtml } from '../src/utils/pagination';
afterEach(cleanup);
describe('outline and A4 revisions', () => {
  it('uses headings from the previous brief and uploaded text', async () => {
    const data = {
      ...initialWizard,
      brief: '# Aim\n# Results',
      references: [
        {
          id: 'ref',
          file: { name: 'rubric.txt', text: async () => '# Discussion\n# Conclusion' } as File,
        },
      ],
    };
    expect((await outlineFromContext(data)).outline).toEqual([
      'Aim',
      'Results',
      'Discussion',
      'Conclusion',
    ]);
    expect(headingsFromText('1. Equipment\n2. Method\nNot a heading in a sentence.')).toEqual([
      'Equipment',
      'Method',
    ]);
  });
  it('renames and removes outline sections without allowing an empty outline', async () => {
    function Harness() {
      const [data, setData] = useState({ ...initialWizard, outline: ['Aim', 'Results'] });
      return <EditableOutline data={data} onChange={setData} />;
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Aim' }));
    await userEvent.clear(screen.getByLabelText('Section 1 name'));
    await userEvent.type(screen.getByLabelText('Section 1 name'), 'My aim');
    await userEvent.click(screen.getByRole('button', { name: 'Save section 1' }));
    expect(screen.getByText('My aim')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Results' }));
    expect(screen.getByRole('button', { name: 'Delete My aim' })).toBeDisabled();
  });
  it('retains text and formatting when long sections are split into page fragments', () => {
    const text = 'Evidence and measurements. '.repeat(100);
    const chunks = splitSectionHtml(`<p><strong>${text}</strong></p>`);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((chunk) => chunk.includes('<strong>'))).toBe(true);
    const node = document.createElement('div');
    node.innerHTML = chunks.join('');
    expect(node.textContent).toBe(text);
  });
  it('escapes plain text fragments and keeps all content', () => {
    const parts = splitSectionHtml('Text &lt;img src=x&gt;');
    const node = document.createElement('div');
    node.innerHTML = parts.join('');
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toBe('Text <img src=x>');
  });
  it('accounts for the cover heading and keeps page order', () => {
    expect(packPages([150, 300, 450, 500], 600, 971)).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(packPages([], 600, 971)).toEqual([[]]);
  });
});
