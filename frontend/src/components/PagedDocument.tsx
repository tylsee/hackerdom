import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { packPages } from '../utils/pagination';
interface Part {
  key: string;
  content: ReactNode;
}
interface Props {
  header: ReactNode;
  parts: Part[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
}
export function PagedDocument({ header, parts, scrollRef }: Props) {
  const [pages, setPages] = useState<number[][]>([parts.map((_, i) => i)]);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(0.85);
  const root = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const partSignature = parts.map((part) => part.key).join('|');
  useEffect(() => {
    const host = scrollRef.current;
    if (!host) return;
    const resize = () => setZoom(Math.min(1, Math.max(0.25, (host.clientWidth - 44) / 794)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [scrollRef]);
  useLayoutEffect(() => {
    if (!root.current) return;
    let frame = 0;
    const measure = () => {
      // Reflow after leaving a field, preserving caret/undo while someone types.
      if (
        root.current?.contains(document.activeElement) &&
        document.activeElement?.closest('[contenteditable],textarea,input')
      )
        return;
      root.current
        ?.querySelectorAll<HTMLElement>('[data-page-part]')
        .forEach((element) => heights.current.set(element.dataset.pagePart!, element.offsetHeight));
      const measured = parts.map((part) => heights.current.get(part.key) || 160);
      const headerHeight = headerRef.current?.offsetHeight || 170;
      const packed = packPages(measured, 971 - headerHeight, 971);
      setPages((old) => (JSON.stringify(old) === JSON.stringify(packed) ? old : packed));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    root.current.querySelectorAll('[data-page-part]').forEach((node) => observer.observe(node));
    if (headerRef.current) observer.observe(headerRef.current);
    root.current.addEventListener('focusout', schedule);
    schedule();
    const node = root.current;
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      node.removeEventListener('focusout', schedule);
    };
  }, [partSignature, JSON.stringify(pages)]);
  useEffect(() => {
    const host = scrollRef.current;
    if (!host || !root.current) return;
    const update = () => {
      const visibleTop = host.getBoundingClientRect().top;
      const sheets = Array.from(root.current!.querySelectorAll<HTMLElement>('.a4-page'));
      let closest = 1,
        distance = Infinity;
      sheets.forEach((sheet, index) => {
        const d = Math.abs(sheet.getBoundingClientRect().top - visibleTop - 28);
        if (d < distance) {
          closest = index + 1;
          distance = d;
        }
      });
      setCurrentPage(closest);
    };
    host.addEventListener('scroll', update, { passive: true });
    update();
    return () => host.removeEventListener('scroll', update);
  }, [pages.length, zoom, scrollRef]);
  const go = (page: number) =>
    root.current?.querySelectorAll('.a4-page')[page - 1]?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  return (
    <>
      <div ref={root} className="a4-stack" style={{ zoom }}>
        {pages.map((items, index) => (
          <article
            className="document-canvas a4-page"
            aria-label={`Document page ${index + 1}`}
            data-page={index + 1}
            key={index}
          >
            {index === 0 && (
              <div ref={headerRef} className="a4-header">
                {header}
              </div>
            )}
            <div className="a4-page-content">
              {items.map(
                (item) =>
                  parts[item] && (
                    <div data-page-part={parts[item].key} key={parts[item].key}>
                      {parts[item].content}
                    </div>
                  ),
              )}
            </div>
            <footer className="a4-footer">
              <span>DocuAI · Review draft</span>
              <span>
                Page {index + 1} of {pages.length}
              </span>
            </footer>
          </article>
        ))}
      </div>
      <div className="page-navigation" role="navigation" aria-label="Document pages">
        <button
          className="icon-button"
          aria-label="Previous document page"
          disabled={currentPage <= 1}
          onClick={() => go(currentPage - 1)}
        >
          <ChevronLeft size={15} />
        </button>
        <span aria-live="polite">
          Page <strong>{Math.min(currentPage, pages.length)}</strong> of{' '}
          <strong>{pages.length}</strong>
        </span>
        <button
          className="icon-button"
          aria-label="Next document page"
          disabled={currentPage >= pages.length}
          onClick={() => go(currentPage + 1)}
        >
          <ChevronRight size={15} />
        </button>
        <small>A4 · 210 × 297 mm</small>
      </div>
    </>
  );
}
