import DOMPurify from 'dompurify';
export function cleanHtml(html: string) {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'style', 'form'],
    ADD_ATTR: ['class'],
  });
}
export function safeUrl(value: string): string | undefined {
  if (!value.trim()) return undefined;
  try {
    const u = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
