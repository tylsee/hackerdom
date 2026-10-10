import { categories } from '../data';
import type { WizardData } from '../types';

export function headingsFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:#{1,3}\s|\d+(?:\.\d+)*[.)]?\s|[\w &/-]{2,65}:$)/.test(line))
    .map((line) => line.replace(/^#{1,3}\s+|^\d+(?:\.\d+)*[.)]?\s+|:$/g, '').trim())
    .filter(Boolean)
    .slice(0, 16);
}
export async function outlineFromContext(
  data: WizardData,
): Promise<{ outline: string[]; outlineSource: string }> {
  const texts = await Promise.all(
    data.references
      .filter((item) => /\.txt$/i.test(item.file.name))
      .map((item) => item.file.text()),
  );
  const headings = headingsFromText([data.brief, ...texts].join('\n'));
  return {
    outline: headings.length ? [...new Set(headings)] : [...categories[data.category].sections],
    outlineSource: headings.length
      ? 'Section headings from your brief / uploaded text. You can edit every heading.'
      : 'References attached. Suggested outline; PDF, image and DOCX content needs backend interpretation.',
  };
}
