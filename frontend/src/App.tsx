import { useRef, useState } from 'react';
import { Check, FileText, Plus, Sparkles, X } from 'lucide-react';
import { categories, initialWizard } from './data';
import { mode, api, milestoneBackend } from './services/api';
import type { DocumentData, UploadItem, WizardData } from './types';
import { Wizard } from './pages/Wizard';
import { Processing } from './pages/Processing';
import { DocumentEditor } from './pages/DocumentEditor';
import { useGeneration } from './hooks/useGeneration';
import { draftKey, readDraft } from './hooks/useAutosave';
import { WaterBackground } from './components/WaterBackground';
import { outlineFromContext } from './utils/outline';
import { validateFile } from './utils/files';
const steps = ['Document', 'Evidence', 'Context', 'Template', 'Generate', 'Editor'];
export default function App() {
  const [data, setData] = useState<WizardData>({
    ...initialWizard,
    settings: { ...initialWizard.settings },
  });
  const [step, setStep] = useState(0);
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [jobId, setJobId] = useState('');
  const [toast, setToast] = useState('');
  const [saved, setSaved] = useState(readDraft);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const generation = useGeneration();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parseController = useRef<AbortController | null>(null);
  const templateToken = useRef(0);
  const outlineSignature = useRef('');
  async function next(skipContext = false) {
    if (step === 3) return start();
    if (step !== 2) return go(step + 1);
    const context = skipContext ? { ...data, brief: '', references: [] } : data;
    const signature = JSON.stringify([
      context.category,
      context.brief,
      context.references.map((item) => item.id),
    ]);
    if (!context.outline || signature !== outlineSignature.current) {
      let derived = await outlineFromContext(context);
      const docx = context.references.find((item) => /\.docx$/i.test(item.file.name));
      if (docx && mode === 'live' && !milestoneBackend) {
        try {
          const mappings = await api.parseTemplate(docx.file, context.category);
          derived = {
            outline: mappings.map((item) => item.heading),
            outlineSource: `Headings from ${docx.file.name}. Edit or remove sections below.`,
          };
        } catch {
          notify(
            'The reference is attached. Its headings could not be read; you can edit the suggested outline.',
          );
        }
      }
      setData({ ...context, ...derived });
      outlineSignature.current = signature;
    } else setData(context);
    go(3);
  }
  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 8500);
  }
  function go(n: number) {
    setStep(n);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function complete(doc: DocumentData, id: string) {
    setDocument(doc);
    setJobId(id);
    go(5);
  }
  async function start() {
    go(4);
    await generation.start(data, complete);
  }
  async function retry() {
    const existing = milestoneBackend ? generation.currentJobId() : undefined;
    const cancelled = await generation.cancel();
    if (cancelled) await generation.start(data, complete, existing);
  }
  async function retryDocumentAnalysis() {
    if (!jobId) return;
    go(4);
    await generation.start({ ...data,
      settings: { ...data.settings, 'Analyse with Gemini': true } }, complete, jobId);
  }
  async function parseTemplate(items: UploadItem[]) {
    parseController.current?.abort();
    const token = ++templateToken.current;
    const file = items[0]?.file || null;
    setData((old) => ({ ...old, templateFile: file, mappings: [] }));
    setTemplateError('');
    setTemplateBusy(false);
    if (!file) return;
    const category = data.category;
    parseController.current = new AbortController();
    setTemplateBusy(true);
    try {
      if (milestoneBackend) {
        const problem = validateFile(file, ['docx']);
        if (problem) throw new Error(problem);
        if (file.size > 8 * 1024 * 1024) throw new Error('DOCX templates must be 8 MiB or smaller.');
        if (token !== templateToken.current) return;
        // The server will inspect styles and headings once a private job exists.
      } else {
        const mappings = await api.parseTemplate(file, category, parseController.current.signal);
        if (token === templateToken.current)
          setData((old) => (old.category === category ? { ...old, mappings } : old));
      }
    } catch (e) {
      if (token === templateToken.current)
        setTemplateError(e instanceof Error ? e.message : 'Could not read the template.');
    } finally {
      if (token === templateToken.current) setTemplateBusy(false);
    }
  }
  function reset() {
    if (
      step === 5 &&
      !window.confirm(
        'Start a new document? Save a JSON draft first if you want to keep this document.',
      )
    )
      return;
    parseController.current?.abort();
    templateToken.current++;
    outlineSignature.current = '';
    setData({ ...initialWizard, settings: { ...initialWizard.settings } });
    setDocument(null);
    setToast('');
    setSaved(null);
    setTemplateBusy(false);
    setTemplateError('');
    localStorage.removeItem(draftKey);
    go(0);
  }
  function updateData(value: WizardData) {
    if (value.category !== data.category) {
      parseController.current?.abort();
      templateToken.current++;
      setTemplateBusy(false);
      setTemplateError('');
    }
    setData(value);
  }
  return (
    <div
      className={`app ${step === 5 ? 'editor-app' : step === 4 ? 'processing-app' : 'wizard-app'} ${step === 0 ? 'welcome-app' : ''}`}
    >
      {step === 0 && <WaterBackground />}
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-header">
        <button className="brand" aria-label="DocuAI home" disabled={step === 4} onClick={reset}>
          <span className="brand-icon">
            <FileText size={22} strokeWidth={1.7} />
            <Sparkles size={10} />
          </span>
          Docu<span>AI</span>
        </button>
        <div className="header-context">
          <span className="header-divider" />
          <span>Documentation, reimagined.</span>
        </div>
        <div className="header-right">
          <span className={`mode-pill ${mode}`}>
            <span />
            {mode === 'demo'
              ? 'Demo workspace'
              : milestoneBackend
                ? 'Connected backend'
                : 'Live API mode'}
          </span>
          {step > 0 && (
            <span className={`category-badge ${data.category}`}>
              {categories[document?.category || data.category].name}
            </span>
          )}
          {step === 5 ? (
            <button className="text-button" onClick={reset}>
              <Plus size={15} /> New document
            </button>
          ) : (
            <span className="avatar" title="Local workspace">
              D
            </span>
          )}
        </div>
      </header>
      {step !== 4 && step !== 5 && (
        <nav className="wizard-stepper" aria-label="Creation progress">
          {steps.slice(0, 4).map((name, i) => (
            <button
              key={name}
              disabled={i > step}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => go(i)}
              className={i === step ? 'active' : i < step ? 'done' : ''}
            >
              <span>{i < step ? <Check size={13} /> : i + 1}</span>
              {name}
              {i < 3 && <i />}
            </button>
          ))}
        </nav>
      )}
      <div id="main-content" tabIndex={-1}>
        {step < 4 ? (
          <>
            <Wizard
              step={step}
              data={data}
              setData={updateData}
              next={(skipContext) => void next(skipContext)}
              back={() => go(step - 1)}
              templateBusy={templateBusy}
              templateError={templateError}
              parseTemplate={(items) => void parseTemplate(items)}
            />
            {step === 0 && saved && (
              <div className="restore-banner">
                <FileText size={18} />
                <span>You have a saved draft on this device.</span>
                <button
                  className="text-button"
                  onClick={() => {
                    setDocument(saved.document);
                    setData((old) => ({
                      ...old,
                      category: saved.document.category,
                      docType: saved.document.docType,
                    }));
                    setJobId(saved.jobId);
                    go(5);
                  }}
                >
                  Resume editing
                </button>
                <button
                  className="icon-button"
                  aria-label="Dismiss saved draft"
                  onClick={() => setSaved(null)}
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </>
        ) : step === 4 ? (
          <Processing
            {...generation}
            cancel={() =>
              void generation.cancel().then((ok) => {
                if (ok) go(3);
              })
            }
            retry={() => void retry()}
            recheck={() => void generation.recheck(complete)}
          />
        ) : document ? (
          <DocumentEditor
            document={document}
            jobId={jobId}
            setDocument={setDocument}
            notify={notify}
            onRetryAnalysis={milestoneBackend && !!jobId
              ? () => { void retryDocumentAnalysis(); } : undefined}
          />
        ) : null}
      </div>
      {step < 4 && (
        <footer className="app-footer">
          <span>Designed for knowledge worth sharing.</span>
          <span>
            DocuAI <span className="footer-spark">✧</span> Dormathon 2026
          </span>
        </footer>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
