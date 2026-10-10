import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  Download,
  FileText,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  PanelLeft,
  ShieldCheck,
  Save,
} from 'lucide-react';
import type { DocumentData, Section } from '../types';
import { api, mode, milestoneBackend } from '../services/api';
import { milestone } from '../services/milestone';
import { EvidenceImage } from '../components/EvidenceImage';
import { safeUrl } from '../utils/security';
import { useAutosave } from '../hooks/useAutosave';
import { RichSection } from '../components/RichSection';
import { PagedDocument } from '../components/PagedDocument';
import { splitSectionHtml } from '../utils/pagination';
import { buildWordDocument, downloadWordDocument } from '../services/docx-export';
interface Props {
  document: DocumentData;
  jobId: string;
  setDocument: (doc: DocumentData) => void;
  notify: (message: string) => void;
  onRetryAnalysis?: () => void;
}
export function DocumentEditor({ document: doc, jobId, setDocument, notify, onRetryAnalysis }: Props) {
  const [active, setActive] = useState(doc.sections[0].id);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [exporting, setExporting] = useState('');
  const editors = useRef(new Map<string, Editor>());
  const docRef = useRef(doc);
  docRef.current = doc;
  const saveStatus = useAutosave(doc, jobId);
  const scroll = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const chunks = useRef(new Map<string, { source: string; fragments: string[] }>());
  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = 'auto';
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    }
  }, [doc.title]);
  useEffect(() => {
    if (!editor) return;
    const update = () => setRevision((r) => r + 1);
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { root: scroll.current, rootMargin: '-5% 0px -60% 0px', threshold: [0, 0.1, 0.5] },
    );
    doc.sections.forEach((s) => {
      const element = window.document.getElementById(s.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [doc.sections.length]);
  function patchSection(id: string, patch: Partial<Section>) {
    const current = docRef.current;
    setDocument({
      ...current,
      sections: current.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  }
  function jump(id: string, flash = false) {
    setActive(id);
    setSidebar(false);
    window.document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
    if (flash) {
      const node = window.document.getElementById(id);
      node?.classList.add('flash');
      setTimeout(() => node?.classList.remove('flash'), 1700);
    }
  }
  async function regenerate(section: Section) {
    if (
      !window.confirm(
        'Replace the text in this section? Your current edits to this section will be replaced.',
      )
    )
      return;
    setBusy(section.id);
    try {
      patchSection(section.id, await api.regenerate(jobId, section, doc.category, doc.docType));
      notify(mode === 'demo' ? 'Sample section restored.' : 'Section regenerated.');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not regenerate this section.');
    } finally {
      setBusy('');
    }
  }
  async function exportDocument(format: 'docx' | 'pdf') {
    setExporting(format);
    try {
      if (format === 'docx' && milestoneBackend) {
        const file = await buildWordDocument(docRef.current, (path) => milestone.image(jobId, path));
        downloadWordDocument(file);
        notify(`Word document downloaded with ${file.figureCount} evidence figure${file.figureCount === 1 ? '' : 's'}.`);
        return;
      }
      const result = await api.export(jobId, docRef.current.sections, {
        title: docRef.current.title,
        meta: docRef.current.meta,
      });
      const url = safeUrl(format === 'docx' ? result.docxUrl || '' : result.pdfUrl || '');
      if (!url)
        throw new Error(`The backend did not return a valid ${format.toUpperCase()} download URL.`);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `${doc.title}.${format}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
      notify('Your download is ready.');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Export failed. Try again.');
    } finally {
      setExporting('');
    }
  }
  function draft() {
    const blob = new Blob([JSON.stringify(docRef.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = 'docuai-draft.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Draft downloaded as JSON.');
  }
  async function downloadScreenshots() {
    setExporting('screenshots');
    try {
      await milestone.download(jobId, doc.frames || []);
      notify('Your screenshots ZIP is ready.');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not download screenshots.');
    } finally {
      setExporting('');
    }
  }
  const commands = [
    {
      label: 'Bold',
      Icon: Bold,
      active: 'bold',
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      Icon: Italic,
      active: 'italic',
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Underline',
      Icon: Underline,
      active: 'underline',
      run: () => editor?.chain().focus().toggleUnderline().run(),
    },
    {
      label: 'Strikethrough',
      Icon: Strikethrough,
      active: 'strike',
      run: () => editor?.chain().focus().toggleStrike().run(),
    },
    {
      label: 'Align left',
      Icon: AlignLeft,
      align: 'left',
      run: () => editor?.chain().focus().setTextAlign('left').run(),
    },
    {
      label: 'Align centre',
      Icon: AlignCenter,
      align: 'center',
      run: () => editor?.chain().focus().setTextAlign('center').run(),
    },
    {
      label: 'Align right',
      Icon: AlignRight,
      align: 'right',
      run: () => editor?.chain().focus().setTextAlign('right').run(),
    },
    {
      label: 'Justify',
      Icon: AlignJustify,
      align: 'justify',
      run: () => editor?.chain().focus().setTextAlign('justify').run(),
    },
    {
      label: 'Bullet list',
      Icon: List,
      active: 'bulletList',
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      Icon: ListOrdered,
      active: 'orderedList',
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    { label: 'Undo', Icon: Undo2, run: () => editor?.chain().focus().undo().run() },
    { label: 'Redo', Icon: Redo2, run: () => editor?.chain().focus().redo().run() },
  ];

  const pageParts = doc.sections.flatMap((s, sectionIndex) => {
    let cached = chunks.current.get(s.id);
    if (!cached || cached.source !== s.html) {
      cached = { source: s.html, fragments: splitSectionHtml(s.html) };
      chunks.current.set(s.id, cached);
    }
    const textParts = cached.fragments.map((html, fragmentIndex) => ({
      key: `${s.id}-text-${fragmentIndex}`,
      content: (
        <section
          id={fragmentIndex === 0 ? s.id : `${s.id}-continued-${fragmentIndex}`}
          className={`document-section ${busy === s.id ? 'regenerating' : ''}`}
        >
          <div className="section-title">
            <h2>
              {s.heading}
              {fragmentIndex > 0 && <small> (continued)</small>}
            </h2>
            {fragmentIndex === 0 && (
              <button
                title={
                  milestoneBackend
                    ? 'Regeneration is not available in this backend yet'
                    : 'Regenerate section'
                }
                aria-label={`Regenerate ${s.heading}`}
                className="icon-button"
                disabled={!!busy || milestoneBackend}
                onClick={() => void regenerate(s)}
              >
                <RefreshCw size={14} className={busy === s.id ? 'spin' : ''} />
              </button>
            )}
          </div>
          <div className={`content-origin ${s.userEdited ? 'edited' : ''}`}>
            {busy === s.id
              ? 'Regenerating…'
              : s.userEdited
                ? 'Edited by you'
                : mode === 'demo'
                  ? 'Sample content'
                  : milestoneBackend && s.id === 'source-evidence'
                    ? 'Extracted evidence'
                    : milestoneBackend && !doc.meta.aiModel
                      ? 'Your notes'
                      : 'AI-generated · review before use'}
          </div>
          <RichSection
            html={html}
            label={fragmentIndex === 0 ? s.heading : `${s.heading} continued ${fragmentIndex}`}
            onChange={(nextHtml) => {
              const value = chunks.current.get(s.id)!;
              value.fragments[fragmentIndex] = nextHtml;
              value.source = value.fragments.join('');
              patchSection(s.id, { html: value.source, userEdited: true });
            }}
            onFocus={(e) => {
              setEditor(e);
              setActive(s.id);
            }}
            onBlur={() => {
              const value = chunks.current.get(s.id)!;
              if (
                value.fragments.some((fragment) => {
                  const node = window.document.createElement('div');
                  node.innerHTML = fragment;
                  return (node.textContent?.length || 0) > 650;
                })
              ) {
                value.fragments = splitSectionHtml(value.source);
                setRevision((r) => r + 1);
              }
            }}
            onReady={(e) => {
              editors.current.set(`${s.id}:${fragmentIndex}`, e);
              if (sectionIndex === 0 && fragmentIndex === 0) setEditor(e);
            }}
          />
        </section>
      ),
    }));
    const figureParts = s.blocks.map((block) => {
      const frame = doc.frames?.find((f) => f.frameId === block.frameId);
      const url = safeUrl(block.fileUrl || frame?.fileUrl || '');
      return {
        key: block.id,
        content: (
          <figure key={block.id} id={block.id}>
            {milestoneBackend && (block.fileUrl || frame?.fileUrl) ? (
              <EvidenceImage
                jobId={jobId}
                path={block.fileUrl || frame!.fileUrl}
                caption={block.caption}
              />
            ) : url ? (
              <img
                src={url}
                alt={block.caption}
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.parentElement?.classList.add('image-unavailable');
                }}
              />
            ) : (
              <div className="figure-placeholder">
                <FileText size={25} />
                <span>Frame {block.frameId}</span>
                <small>Image URL not supplied by the backend.</small>
              </div>
            )}
            <div className="image-error-note">This evidence image could not be loaded.</div>
            <label className="sr-only" htmlFor={`${block.id}-caption`}>
              Caption {block.id}
            </label>
            <input
              id={`${block.id}-caption`}
              className="figure-caption"
              value={block.caption}
              onChange={(e) =>
                patchSection(s.id, {
                  blocks: s.blocks.map((b) =>
                    b.id === block.id ? { ...b, caption: e.target.value } : b,
                  ),
                  userEdited: true,
                })
              }
            />
            {block.checkpoint && (
              <p className="checkpoint">
                <CheckCircle2 size={14} />
                {block.checkpoint}
              </p>
            )}
            <small className="frame-reference">
              Evidence: {block.frameId}
              {block.annotated ? ' · annotated' : ''}
            </small>
          </figure>
        ),
      };
    });
    const flagParts = s.flags.map((flag) => ({
      key: flag.id,
      content: (
        <div key={flag.id} id={flag.id} className="document-flag">
          <AlertTriangle size={15} />
          <div>
            <strong>{flag.level.replaceAll('_', ' ')}</strong>
            <p>{flag.text}</p>
            <small>Frames: {flag.frames.join(', ')}</small>
          </div>
        </div>
      ),
    }));
    return [...textParts, ...figureParts, ...flagParts];
  });
  return (
    <main className="editor-workspace page-enter" data-revision={revision}>
      <div className="editor-titlebar">
        <div className="document-name">
          <span className="file-icon">
            <FileText size={19} />
          </span>
          <div>
            <strong>{doc.docType}</strong>
            <small>
              <span className="save-dot" />
              {saveStatus}
            </small>
          </div>
        </div>
        <div className="editor-title-actions">
          {milestoneBackend && !!doc.frames?.length && (
            <button
              className="secondary small-button"
              disabled={!!exporting}
              onClick={() => void downloadScreenshots()}
            >
              <Download size={15} />
              {exporting === 'screenshots' ? 'Preparing ZIP…' : 'Screenshots ZIP'}
            </button>
          )}
          <button
            className="review-pill"
            aria-label="Toggle evidence review"
            aria-expanded={evidenceOpen}
            onClick={() => setEvidenceOpen(!evidenceOpen)}
          >
            <AlertTriangle size={14} />
            {doc.validation.flagged} to review
          </button>
          <button className="secondary small-button" onClick={draft}>
            <Save size={15} /> Save draft
          </button>
        </div>
      </div>
      <div className="editor-toolbar">
        <button
          className="icon-button mobile-toggle"
          aria-label="Toggle document contents"
          onClick={() => setSidebar(!sidebar)}
        >
          <PanelLeft size={18} />
        </button>
        <div className="toolbar-group">
          <select
            aria-label="Font family"
            value={editor?.getAttributes('textStyle').fontFamily || 'Georgia'}
            onChange={(e) => editor?.chain().focus().setFontFamily(e.target.value).run()}
          >
            <option>Georgia</option>
            <option>Arial</option>
            <option>Verdana</option>
            <option>Times New Roman</option>
          </select>
          <select
            aria-label="Font size"
            value={editor?.getAttributes('textStyle').fontSize || '16px'}
            onChange={(e) => editor?.chain().focus().setFontSize(e.target.value).run()}
          >
            {[12, 14, 16, 18, 20, 24, 28, 32].map((n) => (
              <option key={n} value={`${n}px`}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="format-actions">
          {commands.map(({ label, Icon, run, active: mark, align }, i) => (
            <button
              key={label}
              aria-label={label}
              title={label}
              className={`icon-button ${i === 4 || i === 8 || i === 10 ? 'group-start' : ''}`}
              disabled={!editor}
              aria-pressed={
                mark
                  ? editor?.isActive(mark) || false
                  : align
                    ? editor?.isActive({ textAlign: align }) || false
                    : undefined
              }
              onMouseDown={(e) => e.preventDefault()}
              onClick={run}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
        <div className="export-actions">
          <button
            className="secondary small-button"
            onClick={() => void exportDocument('docx')}
            disabled={!!exporting}
            title={milestoneBackend ? 'Download an editable Word document with your text and evidence figures.' : undefined}
          >
            <Download size={15} />
            {exporting === 'docx' ? 'Preparing…' : 'Word'}
          </button>
          <button
            className="primary small-button"
            onClick={() => void exportDocument('pdf')}
            disabled={!!exporting || milestoneBackend}
            title={milestoneBackend ? 'PDF export is not implemented through Milestone 7.' : undefined}
          >
            <Download size={15} />
            {exporting === 'pdf' ? 'Preparing…' : 'PDF'}
          </button>
          {milestoneBackend && <span className="small muted" title="Custom template appearance may differ; PDF export requires a later milestone.">Word ready · PDF coming later</span>}
        </div>
      </div>
      <div className="editor-layout">
        <aside className={`contents-panel ${sidebar ? 'open' : ''}`}>
          <span className="eyebrow">IN THIS DOCUMENT</span>
          <h2>Contents</h2>
          <nav aria-label="Document contents">
            {doc.sections.map((s, i) => (
              <button
                className={active === s.id ? 'active' : ''}
                key={s.id}
                onClick={() => jump(s.id)}
              >
                <span>{String(i + 1).padStart(2, '0')}</span>
                {s.heading.replace(/^\d+\.\d+\s*/, '')}
                <ChevronRight size={13} />
              </button>
            ))}
          </nav>
          <div className="contents-note">
            <ShieldCheck size={21} />
            <strong>Clarity you can check.</strong>
            <p>Review every flag and compare it with your evidence before sharing.</p>
          </div>
        </aside>
        <div ref={scroll} className="document-scroll">
          <PagedDocument
            scrollRef={scroll}
            parts={pageParts}
            header={
              <>
                <div className="document-kicker">
                  {doc.docType.toUpperCase()}{' '}
                  <span>
                    {mode === 'demo'
                      ? 'SAMPLE DOCUMENT'
                      : milestoneBackend
                        ? 'EVIDENCE WORKSPACE'
                        : 'GENERATED DRAFT'}
                  </span>
                </div>
                <label className="sr-only" htmlFor="document-title">
                  Document title
                </label>
                <textarea
                  ref={titleRef}
                  id="document-title"
                  className="document-title"
                  value={doc.title}
                  rows={1}
                  onChange={(e) => setDocument({ ...docRef.current, title: e.target.value })}
                />
                <div className="document-meta">
                  {Object.entries(doc.meta).map(([key, value]) => (
                    <span key={key}>
                      {key}: {value}
                    </span>
                  ))}
                </div>
              </>
            }
          />
        </div>
        <aside className={`evidence-panel ${evidenceOpen ? 'open' : ''}`}>
          <span className="eyebrow">BUILT ON EVIDENCE</span>
          <h2>Document health</h2>
          <div className="evidence-stats">
            <div>
              <strong>{doc.validation.steps}</strong>
              <span>Process steps</span>
            </div>
            <div>
              <strong>{doc.validation.figures}</strong>
              <span>Figures</span>
            </div>
            <div className="verified">
              <strong>{doc.validation.verified}</strong>
              <span>{milestoneBackend ? 'Independently checked' : 'Verified'}</span>
            </div>
            <div className="flagged">
              <strong>{doc.validation.flagged}</strong>
              <span>To review</span>
            </div>
          </div>
          <div className="evidence-status">
            <CheckCircle2 size={16} />
            <span>
              {mode === 'demo'
                ? 'Sample verification counts'
                : milestoneBackend
                  ? 'Review screenshots and any AI steps yourself'
                  : 'Evidence verification complete'}
            </span>
          </div>
          {milestoneBackend && doc.templateLayout && (
            <div className="template-preview" aria-label="Word template layout preview">
              <h3>Word template layout</h3>
              <p className="small">
                {doc.templateLayout.source === 'uploaded'
                  ? `Uploaded: ${doc.templateLayout.filename}`
                  : 'Default backend Word style profile'}
              </p>
              <p className="small muted">
                {doc.templateLayout.sections.filter((s) => s.templateMatched).length} of{' '}
                {doc.templateLayout.sections.length} document sections match uploaded headings.
              </p>
              {doc.templateLayout.sections.map((section, i) => (
                <p className="small" key={`${i}-${section.heading}`}>
                  {section.heading} → {section.templateHeading}
                  {section.templateMatched ? ' (matched)' : ' (default style)'}
                </p>
              ))}
              {doc.templateLayout.unmatchedHeadings.length > 0 && (
                <p className="small muted">
                  Unmatched template headings: {doc.templateLayout.unmatchedHeadings.join(', ')}.
                </p>
              )}
              <p className="small muted">The template is stored privately. Exact Word layout and export are not yet available.</p>
            </div>
          )}
          {milestoneBackend && doc.validation.steps === 0 && onRetryAnalysis && (
            <div className="missing" role="status">
              <h3>AI instructions unavailable</h3>
              <p>Only evidence frames are available. Retry Gemini analysis on this same uploaded job to generate instructions and captions.</p>
              <button className="primary small-button" onClick={onRetryAnalysis}>
                <RefreshCw size={15} /> Retry AI analysis
              </button>
            </div>
          )}
          <h3>Needs your attention</h3>
          {doc.sections.flatMap((s) =>
            s.flags.map((flag) => (
              <button className="flag-card" key={flag.id} onClick={() => jump(flag.id, true)}>
                <span>
                  <AlertTriangle size={15} />
                  {flag.level}
                </span>
                <p>{flag.text}</p>
                <small>
                  Review evidence <ChevronRight size={12} />
                </small>
              </button>
            )),
          )}
          {!doc.validation.flagged && <p className="small muted">No evidence flags reported.</p>}
          {doc.missing.length > 0 && (
            <div className="missing">
              <h3>Requirements to check</h3>
              {doc.missing.map((m) => (
                <p key={m}>{m}</p>
              ))}
            </div>
          )}
          <h3>Figure references</h3>
          {doc.sections.flatMap((s) =>
            s.blocks.map((b) => (
              <button className="figure-link" key={b.id} onClick={() => jump(b.id, true)}>
                <FileText size={15} />
                <span>
                  {b.caption}
                  <small>{b.frameId}</small>
                </span>
                <ChevronRight size={13} />
              </button>
            )),
          )}
        </aside>
      </div>
    </main>
  );
}
