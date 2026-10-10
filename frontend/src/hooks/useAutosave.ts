import { useEffect, useState } from 'react';
import type { DocumentData, SavedDraft } from '../types';
import { mode, validateDocument } from '../services/api';
export const draftKey = 'docuai-draft-v1';
export function readDraft(): SavedDraft | null {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (!saved || saved.mode !== mode || typeof saved.jobId !== 'string') return null;
    return { ...saved, document: validateDocument(saved.document) };
  } catch {
    return null;
  }
}
export function useAutosave(document: DocumentData, jobId: string) {
  const [status, setStatus] = useState('Saving…');
  useEffect(() => {
    setStatus('Saving…');
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ document, jobId, mode }));
        setStatus('Saved on this device');
      } catch {
        setStatus('Local save unavailable — download a draft');
      }
    }, 650);
    return () => clearTimeout(timer);
  }, [document, jobId]);
  return status;
}
