import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, FileText } from 'lucide-react';
import type { WizardData } from '../types';
import { categories } from '../data';

export function EditableOutline({
  data,
  onChange,
}: {
  data: WizardData;
  onChange: (data: WizardData) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const outline = data.outline ?? [...categories[data.category].sections];
  const commit = () => {
    if (editing === null || !value.trim()) return;
    onChange({
      ...data,
      outline: outline.map((heading, i) => (i === editing ? value.trim() : heading)),
    });
    setEditing(null);
  };
  return (
    <section className="panel template-preview editable-outline">
      <div className="outline-heading">
        <span className="eyebrow">YOUR DOCUMENT OUTLINE</span>
        <button
          className="text-button"
          onClick={() => {
            onChange({ ...data, outline: [...outline, 'New section'] });
            setEditing(outline.length);
            setValue('New section');
          }}
        >
          <Plus size={13} /> Add section
        </button>
      </div>
      {(data.references.length > 0 || data.brief.trim()) && (
        <div className="outline-sources">
          <FileText size={14} />
          <span>
            {data.references.length
              ? data.references.map((item) => item.file.name).join(' · ')
              : 'Your document brief'}
            <small>
              {data.outlineSource ||
                'Attached requirements carried forward. Rename the sections to match your brief.'}
            </small>
          </span>
        </div>
      )}
      <div className="outline-rows">
        {outline.map((heading, i) => (
          <div className="outline-row" key={i}>
            <span className="outline-number">{String(i + 1).padStart(2, '0')}</span>
            {editing === i ? (
              <input
                autoFocus
                aria-label={`Section ${i + 1} name`}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commit();
                  if (event.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <span className="outline-name">{heading}</span>
            )}
            <button
              className="icon-button"
              aria-label={editing === i ? `Save section ${i + 1}` : `Edit ${heading}`}
              title={editing === i ? 'Save section' : 'Rename section'}
              onClick={() => {
                if (editing === i) commit();
                else {
                  setEditing(i);
                  setValue(heading);
                }
              }}
            >
              {editing === i ? <Check size={14} /> : <Pencil size={13} />}
            </button>
            <button
              className="icon-button"
              disabled={outline.length === 1}
              aria-label={`Delete ${heading}`}
              title="Delete section"
              onClick={() => {
                onChange({ ...data, outline: outline.filter((_, j) => i !== j) });
                setEditing(null);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <p className="outline-help">Your section names will follow through to the document.</p>
    </section>
  );
}
