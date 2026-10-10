import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Heart,
  ShieldCheck,
  Sparkles,
  Video,
  Images,
  MousePointer2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { Category, WizardData, UploadItem } from '../types';
import { categories } from '../data';
import { UploadZone } from '../components/UploadZone';
import { EditableOutline } from '../components/EditableOutline';
import { milestoneBackend, mode } from '../services/api';
import { evidenceIssue } from '../services/milestone';
const icons = { education: BookOpen, work: Briefcase, personal: Heart };
interface Props {
  step: number;
  data: WizardData;
  setData: (data: WizardData) => void;
  next: (skipContext?: boolean) => void;
  back: () => void;
  templateBusy: boolean;
  templateError: string;
  parseTemplate: (items: UploadItem[]) => void;
}
export function Wizard({
  step,
  data,
  setData,
  next,
  back,
  templateBusy,
  templateError,
  parseTemplate,
}: Props) {
  const cat = categories[data.category];
  const issue = milestoneBackend ? evidenceIssue(data) : '';
  const [editingMapping, setEditingMapping] = useState<number | null>(null);
  const [mappingName, setMappingName] = useState('');
  const patch = (d: Partial<WizardData>) => setData({ ...data, ...d });
  const choose = (category: Category, docType: string) =>
    patch({
      category,
      docType,
      templateMode: 'builtin',
      templateFile: null,
      mappings: [],
      outline: undefined,
      outlineSource: undefined,
    });
  const ready =
    step === 0
      ? !!data.docType
      : step === 1
        ? data.evidence.length > 0 && !issue
        : step === 3
          ? data.templateMode === 'builtin' ||
            (!!data.templateFile && !templateBusy && !templateError &&
              (milestoneBackend ||
                (data.mappings.length > 0 && data.mappings.every((m) => m.section !== 'Unmapped'))))
          : true;
  return (
    <main className={`wizard page-enter wizard-step-${step} ${step === 0 ? 'welcome' : ''}`}>
      <div className="page-heading">
        <span className="eyebrow">
          {
            ['YOUR KNOWLEDGE. A NEW CHAPTER.', '01 / EVIDENCE', '02 / CONTEXT', '03 / TEMPLATE'][
              step
            ]
          }
        </span>
        <h1>
          {step === 0 ? (
            <>
              <span className="hero-line first-line">Do it once.</span>
              <br />
              <span className="hero-line automatic-line">
                Document it <span className="automatic-word">automatically.</span>
              </span>
            </>
          ) : (
            [
              '',
              'Start with what you’ve done.',
              'Give your document direction.',
              'A structure that fits your story.',
            ][step]
          )}
        </h1>
        <p>
          {
            [
              'Turn a recording into a document others can follow. What are you creating?',
              milestoneBackend
                ? 'Choose one recording or a set of screenshots for your private evidence job.'
                : 'One recording, a few screenshots, or both. We’ll connect the dots.',
              'Add a little context. Better inputs make more useful documents.',
              'Start with a thoughtful template, or bring one of your own.',
            ][step]
          }
        </p>
      </div>
      {step === 0 && (
        <>
          <div className="category-grid">
            {(Object.keys(categories) as Category[]).map((key) => {
              const c = categories[key];
              const Icon = icons[key];
              const selected = data.category === key;
              return (
                <article key={key} className={`category-card ${key} ${selected ? 'selected' : ''}`}>
                  <div className="category-top">
                    <span className="category-icon">
                      <Icon size={25} strokeWidth={1.6} />
                    </span>
                    <span className={`selection-dot ${selected ? 'on' : ''}`}>
                      {selected && <Check size={13} />}
                    </span>
                  </div>
                  <button
                    className="category-title"
                    onClick={() => choose(key, c.types[0])}
                    aria-pressed={selected}
                  >
                    {c.name}
                  </button>
                  <p>{c.description}</p>
                  <div className="type-chips">
                    {c.types.map((type) => (
                      <button
                        key={type}
                        className={selected && data.docType === type ? 'chosen' : ''}
                        onClick={() => choose(key, type)}
                        aria-pressed={selected && data.docType === type}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <small>{c.tone}</small>
                </article>
              );
            })}
          </div>
          <div className="welcome-bottom">
            <div>
              <ShieldCheck size={17} />
              <span>Evidence comes first. Anything unclear is flagged for your review.</span>
            </div>
            <button className="primary" onClick={() => next()}>
              Create a document <ArrowRight size={17} />
            </button>
          </div>
          <div className="workflow-preview">
            <div className="preview-label">
              <span className="mini-logo">
                <FileText size={21} />
              </span>
              <div>
                <strong>From process to possibility.</strong>
                <p>Three simple moves. One document worth sharing.</p>
              </div>
            </div>
            <div className="mini-flow">
              <span>
                <Video size={18} /> Upload
              </span>
              <ArrowRight size={14} />
              <span>
                <Sparkles size={18} /> Generate
              </span>
              <ArrowRight size={14} />
              <span>
                <MousePointer2 size={18} /> Make it yours
              </span>
            </div>
          </div>
        </>
      )}
      {step === 1 && (
        <>
          <div className="evidence-grid">
            <section className="panel">
              <div className="panel-heading">
                <Video size={19} />
                <h2>Your recording</h2>
                <span className="quiet-label">
                  {milestoneBackend ? '3 MIN · 80 MiB MAX' : 'ANY LENGTH'}
                </span>
              </div>
              <UploadZone
                title="Drop your recording here"
                description="or click to choose a video"
                allowed={milestoneBackend ? ['mp4', 'mov', 'webm'] : ['mp4', 'mov', 'mkv', 'webm']}
                items={data.evidence.filter((i) => /\.(mp4|mov|mkv|webm)$/i.test(i.file.name))}
                onChange={(items) =>
                  patch({
                    evidence: [
                      ...data.evidence.filter((i) => !/\.(mp4|mov|mkv|webm)$/i.test(i.file.name)),
                      ...items,
                    ],
                  })
                }
              />
            </section>
            <section className="panel">
              <div className="panel-heading">
                <Images size={19} />
                <h2>Screenshots</h2>
                <span className="quiet-label">
                  {milestoneBackend ? 'OR · 12 MAX · 5 MiB EACH' : 'OPTIONAL'}
                </span>
              </div>
              <UploadZone
                title="Add the details that matter"
                description="drop screenshots or click to browse"
                allowed={['png', 'jpg', 'jpeg', 'webp']}
                items={data.evidence.filter((i) => /\.(png|jpe?g|webp)$/i.test(i.file.name))}
                onChange={(items) =>
                  patch({
                    evidence: [
                      ...data.evidence.filter((i) => !/\.(png|jpe?g|webp)$/i.test(i.file.name)),
                      ...items,
                    ],
                  })
                }
              />
            </section>
          </div>
          {issue && (
            <p role="alert" className="inline-error">
              {issue}
            </p>
          )}
          <div className="reassurance">
            <CheckCircle2 size={18} />
            <span>
              No voiceover needed. Your recording doesn’t need narration, captions or subtitles.
            </span>
          </div>
          <section className="settings">
            <div>
              <h3>Thoughtful defaults</h3>
              <p>
                {milestoneBackend
                  ? 'Gemini creates the procedure and its figures. Disable AI to prepare evidence only. A document draft requires successful AI analysis.'
                  : 'Requested processing preferences for your backend.'}
              </p>
            </div>
            <div className="settings-grid">
              {Object.entries(
                milestoneBackend
                  ? { 'Analyse with Gemini': data.settings['Analyse with Gemini'] || false }
                  : data.settings,
              ).map(([name, value]) => (
                <label key={name}>
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) =>
                      patch({ settings: { ...data.settings, [name]: e.target.checked } })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
          </section>
        </>
      )}
      {step === 2 && (
        <div className="two-column">
          <section className="panel context-panel">
            <label htmlFor="brief">
              <h2>What should this document cover?</h2>
            </label>
            <p>Describe the goal, audience, or requirements you need to meet.</p>
            <textarea
              id="brief"
              placeholder={
                data.category === 'education'
                  ? 'e.g. Write a lab report on Hooke’s law. Include the setup, procedure, results table and a discussion of measurement error.'
                  : 'e.g. Create a clear guide someone can follow without needing to ask me.'
              }
              value={data.brief}
              onChange={(e) => patch({ brief: e.target.value })}
              rows={8}
            />
            <div className="textarea-footer">
              <span>Plain language is perfect.</span>
              <span>{data.brief.length} characters</span>
            </div>
            <h3>Include the essentials</h3>
            <div className="requirement-chips">
              {cat.chips.map((chip) => (
                <button
                  key={chip}
                  aria-pressed={data.brief.includes(chip)}
                  onClick={() =>
                    patch({
                      brief: data.brief.includes(chip)
                        ? data.brief
                            .split('\n')
                            .filter((line) => line !== chip)
                            .join('\n')
                        : `${data.brief}${data.brief ? '\n' : ''}${chip}`,
                    })
                  }
                >
                  {data.brief.includes(chip) ? <Check size={13} /> : <span>+</span>}
                  {chip}
                </button>
              ))}
            </div>
          </section>
          <aside className="panel">
            <h2>Have a source of truth?</h2>
            <p>
              {milestoneBackend
                ? 'Paste your requirements in the brief or attach TXT text. This backend cannot read PDF, DOCX or image references yet.'
                : 'Upload an assignment brief, rubric, manual, or a photo of your requirements.'}
            </p>
            <UploadZone
              compact
              title="Add reference files"
              description="click or drag files here"
              allowed={milestoneBackend ? ['txt'] : ['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg']}
              items={data.references}
              onChange={(items) => patch({ references: items })}
            />
            <div className="aside-note">
              <ShieldCheck size={19} />
              <p>
                Optional, but useful. Without context, the document won’t know your marking scheme
                or specific requirements.
              </p>
            </div>
          </aside>
        </div>
      )}
      {step === 3 && (
        <div className="two-column">
          <div>
            <div className="template-options">
              <button
                className={`template-option ${data.templateMode === 'builtin' ? 'selected' : ''}`}
                onClick={() => patch({ templateMode: 'builtin' })}
              >
                <FileText size={24} />
                <span>
                  <strong>{cat.template}</strong>
                  <small>A ready-to-use structure for {cat.name.toLowerCase()}.</small>
                </span>
                <span className="selection-dot on">
                  {data.templateMode === 'builtin' && <Check size={13} />}
                </span>
              </button>
              <button
                className={`template-option ${data.templateMode === 'custom' ? 'selected' : ''}`}
                onClick={() => patch({ templateMode: 'custom' })}
              >
                <span className="template-plus">+</span>
                <span>
                  <strong>Bring your own template</strong>
                  <small>
                    {milestoneBackend
                      ? 'Upload a DOCX; the backend will inspect its headings and styles.'
                      : 'Keep the structure you already work with.'}
                  </small>
                </span>
                <span className="selection-dot">
                  {data.templateMode === 'custom' && <Check size={13} />}
                </span>
              </button>
            </div>
            {data.templateMode === 'builtin' ? (
              <EditableOutline data={data} onChange={setData} />
            ) : (
              <section className="panel">
                <UploadZone
                  compact
                  single
                  title="Upload a DOCX template"
                  description="we’ll match the headings to your document"
                  allowed={['docx']}
                  items={data.templateFile ? [{ id: 'template', file: data.templateFile }] : []}
                  onChange={parseTemplate}
                />
                {templateBusy && <p role="status">Reading template headings…</p>}
                {templateError && (
                  <p role="alert" className="inline-error">
                    {templateError}
                  </p>
                )}
                {milestoneBackend && data.templateFile && !templateError && (
                  <p className="small muted" role="status">
                    Selected: {data.templateFile.name}. The DOCX will be validated on upload.
                    Its actual heading matches and Word styles appear in your document preview.
                    Manual heading remapping is not supported until a later milestone.
                  </p>
                )}
                {!milestoneBackend && data.mappings.length > 0 && (
                  <>
                    <div className="mapping-heading">
                      <h3>Match your sections</h3>
                      <span className="quiet-label">
                        {import.meta.env.VITE_API_MODE === 'live'
                          ? 'BACKEND MAPPING'
                          : 'DEMO MAPPING'}
                      </span>
                    </div>
                    <div className="mapping-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Template heading</th>
                            <th>DocuAI section</th>
                            <th>Match</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.mappings.map((m, i) => (
                            <tr key={i}>
                              <td>
                                <div className="mapping-name">
                                  {editingMapping === i ? (
                                    <input
                                      autoFocus
                                      aria-label={`Template section ${i + 1} name`}
                                      value={mappingName}
                                      onChange={(event) => setMappingName(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Escape') setEditingMapping(null);
                                      }}
                                    />
                                  ) : (
                                    <span>{m.heading}</span>
                                  )}
                                  <button
                                    className="icon-button"
                                    aria-label={
                                      editingMapping === i
                                        ? `Save template section ${i + 1}`
                                        : `Edit template ${m.heading}`
                                    }
                                    onClick={() => {
                                      if (editingMapping === i) {
                                        if (mappingName.trim()) {
                                          patch({
                                            mappings: data.mappings.map((row, index) =>
                                              index === i
                                                ? { ...row, heading: mappingName.trim() }
                                                : row,
                                            ),
                                          });
                                          setEditingMapping(null);
                                        }
                                      } else {
                                        setMappingName(m.heading);
                                        setEditingMapping(i);
                                      }
                                    }}
                                  >
                                    {editingMapping === i ? (
                                      <Check size={12} />
                                    ) : (
                                      <Pencil size={12} />
                                    )}
                                  </button>
                                  <button
                                    className="icon-button"
                                    disabled={data.mappings.length === 1}
                                    aria-label={`Delete template ${m.heading}`}
                                    onClick={() => {
                                      patch({
                                        mappings: data.mappings.filter((_, index) => index !== i),
                                      });
                                      setEditingMapping(null);
                                    }}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </td>
                              <td>
                                <select
                                  aria-label={`Map ${m.heading}`}
                                  value={m.section}
                                  onChange={(e) =>
                                    patch({
                                      mappings: data.mappings.map((old, j) =>
                                        i === j
                                          ? { ...old, section: e.target.value, confidence: 'check' }
                                          : old,
                                      ),
                                    })
                                  }
                                >
                                  <option>Unmapped</option>
                                  {cat.sections.map((s) => (
                                    <option key={s}>{s}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <span className={`match ${m.confidence}`}>{m.confidence}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="small muted">
                      {import.meta.env.VITE_API_MODE === 'live'
                        ? 'Confirm each heading before continuing.'
                        : 'Sample headings only. Your DOCX is not parsed in demo mode.'}
                    </p>
                  </>
                )}
              </section>
            )}
          </div>
          <aside className="panel template-aside">
            <span className="category-icon">
              <Sparkles size={24} />
            </span>
            <h2>Made for {cat.name.toLowerCase()}.</h2>
            <p>
              {milestoneBackend
                ? 'Gemini builds the document from your recording or screenshots. The backend stores the SOP draft and previews custom DOCX heading matches.'
                : 'Your category quietly takes care of the details.'}
            </p>
            <h3>{milestoneBackend ? 'Suggested conventions' : 'Applied automatically'}</h3>
            {cat.conventions.map((c) => (
              <div className="convention" key={c}>
                <CheckCircle2 size={17} />
                {c}
              </div>
            ))}
            <div className="tone-note">
              <span className="eyebrow">WRITING STYLE</span>
              <strong>{cat.tone}</strong>
            </div>
          </aside>
        </div>
      )}
      {step > 0 && (
        <div className="wizard-footer">
          <button className="secondary" onClick={back}>
            <ChevronLeft size={16} /> Back
          </button>
          <span className="footer-note">
            {step === 1
              ? mode === 'demo'
                ? 'Your files stay on this device in demo mode.'
                : 'Your evidence is uploaded to your private backend job.'
              : step === 2
                ? 'Context is optional. You can add details later.'
                : 'You can edit every section after generation.'}
          </span>
          <div className="footer-actions">
            {step === 2 && (
              <button
                className="text-button"
                onClick={() => {
                  next(true);
                }}
              >
                Skip for now
              </button>
            )}
            <button className="primary" disabled={!ready} onClick={() => next()}>
              {step === 3 ? (
                <>
                  <Sparkles size={16} />{' '}
                  Generate document
                </>
              ) : (
                <>
                  Continue <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
