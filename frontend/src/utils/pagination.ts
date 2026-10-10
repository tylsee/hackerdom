// Break long HTML at text boundaries while retaining inline formatting.
// These are editor fragments only: API write-back remains one HTML string per section.
export function splitSectionHtml(html: string, limit = 650): string[] {
  const container = document.createElement('div');
  container.innerHTML = html;
  const chunks: string[] = [];
  let current = '',
    length = 0;
  const flush = () => {
    if (current) chunks.push(current);
    current = '';
    length = 0;
  };
  for (const original of Array.from(container.childNodes)) {
    let node = original;
    if (!(node instanceof HTMLElement)) {
      const paragraph = document.createElement('p');
      paragraph.textContent = node.textContent;
      node = paragraph;
    }
    const text = node.textContent || '';
    const markup =
      node instanceof HTMLElement ? node.outerHTML : `<p>${node.textContent || ''}</p>`;
    if (text.length <= limit) {
      if (length + text.length > limit) flush();
      current += markup;
      length += text.length;
      continue;
    }
    flush();
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    const point = (offset: number): [Node, number] => {
      let remaining = offset;
      for (const textNode of texts) {
        if (remaining <= textNode.length) return [textNode, remaining];
        remaining -= textNode.length;
      }
      return [texts[texts.length - 1], texts[texts.length - 1].length];
    };
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + limit, text.length);
      if (end < text.length) {
        const space = text.lastIndexOf(' ', end);
        if (space > start + limit * 0.7) end = space + 1;
      }
      const range = document.createRange();
      const [startNode, startOffset] = point(start);
      const [endNode, endOffset] = point(end);
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const wrapper =
        node instanceof HTMLElement
          ? (node.cloneNode(false) as HTMLElement)
          : document.createElement('p');
      if (wrapper.tagName === 'OL') {
        const listItem = startNode.parentElement?.closest('li');
        const items = Array.from((node as HTMLElement).children);
        if (listItem)
          wrapper.setAttribute(
            'start',
            String(
              Number((node as HTMLElement).getAttribute('start') || 1) +
                Math.max(0, items.indexOf(listItem)),
            ),
          );
      }
      let fragment = range.cloneContents();
      let ancestor =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : (range.commonAncestorContainer as HTMLElement);
      while (ancestor && ancestor !== node) {
        const shell = ancestor.cloneNode(false) as HTMLElement;
        shell.append(fragment);
        fragment = document.createDocumentFragment();
        fragment.append(shell);
        ancestor = ancestor.parentElement;
      }
      wrapper.append(fragment);
      chunks.push(wrapper.outerHTML);
      start = end;
    }
  }
  flush();
  return chunks.length ? chunks : ['<p></p>'];
}
export function packPages(heights: number[], firstCapacity: number, capacity: number): number[][] {
  const pages: number[][] = [[]];
  let available = firstCapacity;
  heights.forEach((height, index) => {
    if (height > available && pages[pages.length - 1].length) {
      pages.push([]);
      available = capacity;
    }
    pages[pages.length - 1].push(index);
    available -= height;
  });
  return pages;
}
