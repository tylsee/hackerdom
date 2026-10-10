export type Category = 'education' | 'work' | 'personal';
export interface Figure {
  type: 'figure';
  id: string;
  frameId: string;
  caption: string;
  checkpoint: string | null;
  annotated: boolean;
  fileUrl?: string;
}
export interface Flag {
  id: string;
  level: string;
  text: string;
  frames: string[];
}
export interface Section {
  id: string;
  heading: string;
  html: string;
  blocks: Figure[];
  flags: Flag[];
  userEdited?: boolean;
}
export interface TemplateLayoutPreview {
  source: 'default' | 'uploaded';
  filename: string | null;
  styles: { title: string; heading1: string; heading2: string; body: string };
  sections: { heading: string; templateHeading: string; templateMatched: boolean; headingStyleId: string }[];
  unmatchedHeadings: string[];
  note: string;
}
export interface DocumentData {
  category: Category;
  docType: string;
  title: string;
  meta: Record<string, string>;
  sections: Section[];
  validation: { steps: number; figures: number; verified: number; flagged: number };
  missing: string[];
  templateLayout?: TemplateLayoutPreview;
  frames?: { frameId: string; timestamp?: number; fileUrl: string }[];
}
export interface Mapping {
  heading: string;
  section: string;
  confidence: 'auto' | 'check';
}
export interface UploadItem {
  id: string;
  file: File;
  duration?: number;
  metadataWarning?: string;
}
export interface WizardData {
  category: Category;
  docType: string;
  evidence: UploadItem[];
  references: UploadItem[];
  brief: string;
  templateMode: 'builtin' | 'custom';
  templateFile: File | null;
  mappings: Mapping[];
  outline?: string[];
  outlineSource?: string;
  settings: Record<string, boolean>;
}
export interface JobRequest {
  category: Category;
  docType: string;
  videoFileId: string | null;
  imageFileIds: string[];
  briefText: string;
  briefFileIds: string[];
  template: {
    type: 'builtin' | 'custom';
    fileId?: string;
    mapping?: Mapping[];
    sections?: string[];
  };
  extractionSettings?: {
    captureOnChange: boolean;
    dedupe: boolean;
    splitLongVideos: boolean;
    flagSensitiveData: boolean;
  };
}
export interface JobStatus {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  stage: number | string;
  progress: number;
  message: string;
}
export interface SavedDraft {
  document: DocumentData;
  jobId: string;
  mode: 'demo' | 'live';
}
