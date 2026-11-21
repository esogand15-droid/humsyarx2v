/**
 * TextLayer - Semantic text overlay for PDF pages
 * 
 * Extracts text content from pdf.js and renders invisible positioned spans
 * enabling text selection, copy, search highlighting, and semantic annotations.
 * 
 * Architecture:
 * - Uses pdf.js getTextContent() to extract glyphs with positions
 * - Transforms PDF coordinate space (points, origin bottom-left) to CSS (pixels, origin top-left)
 * - Renders absolutely positioned <span> elements matching glyph bounding boxes
 * - Provides hooks for selection, search highlights, and annotation anchoring
 */

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';

export interface TextItem {
  str: string;
  transform: number[];
  fontName: string;
  width: number;
  height: number;
  dir: string;
  transformOriginX?: number;
  transformOriginY?: number;
}

interface TextLayerProps {
  pageNumber: number;
  viewport: any;
  textContent?: any | null;
  onTextContent?: (content: any) => void;
  searchQuery?: string;
  searchMatches?: number[];
  onSelectionChange?: (text: string, rects: DOMRect[]) => void;
  onAnchorAnnotation?: (pageX: number, pageY: number, text: string) => void;
  enableSelection?: boolean;
  className?: string;
  renderScale?: number;
}

export interface TextLayerRef {
  getSelection: () => { text: string; rects: DOMRect[] } | null;
  clearSelection: () => void;
  scrollToMatch: (index: number) => void;
  getTextItems: () => any[];
}

const TextLayer = forwardRef<TextLayerRef, TextLayerProps>(({
  viewport,
  textContent: initialTextContent,
  onTextContent,
  searchQuery = '',
  searchMatches = [],
  onSelectionChange,
  enableSelection = true,
  className = '',
  renderScale = 1,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const spansRef = useRef<Map<number, HTMLSpanElement>>(new Map());
  const textContentRef = useRef<any>(null);
  const [textContentLoaded, setTextContentLoaded] = useState(false);
  const selectionRef = useRef<Selection | null>(null);
  const matchHighlightsRef = useRef<Set<number>>(new Set());

  // Convert PDF point (origin bottom-left) to CSS point (origin top-left)
  const pdfToCss = useCallback((x: number, y: number) => {
    if (!viewport || !viewport.transform) return { x: 0, y: 0 };
    const { x: cssX, y: cssY } = viewport.transform(x, y);
    return {
      x: cssX * renderScale,
      y: cssY * renderScale,
    };
  }, [viewport, renderScale]);

  // Render text items as positioned spans
  const renderTextItems = useCallback(() => {
    const content = textContentRef.current;
    if (!content || !containerRef.current) return;

    const fragment = document.createDocumentFragment();
    const container = containerRef.current;
    container.innerHTML = ''; // Clear previous
    spansRef.current.clear();

    // Set container size to match viewport
    container.style.width = `${viewport?.width ?? 0}px`;
    container.style.height = `${viewport?.height ?? 0}px`;
    container.style.position = 'relative';

    content.items.forEach((item: any, index: number) => {
      if (!item.str?.trim()) return; // Skip whitespace-only

      const [scaleX, , , scaleY, tx, ty] = item.transform;
      const x = tx * scaleX;
      const y = ty * scaleY;
      const width = item.width * scaleX;
      const height = item.height * scaleY;

      // Convert to CSS coordinates
      const { x: cssX, y: cssY } = pdfToCss(x, y);

      const span = document.createElement('span');
      span.dataset.textIndex = String(index);
      span.textContent = item.str;
      span.style.cssText = 
        'position: absolute;' +
        'left: ' + cssX + 'px;' +
        'top: ' + cssY + 'px;' +
        'width: ' + width + 'px;' +
        'height: ' + height + 'px;' +
        'font-size: ' + height + 'px;' +
        'line-height: 1;' +
        'white-space: pre;' +
        'cursor: text;' +
        'user-select: text;' +
        '-webkit-user-select: text;' +
        'color: transparent;' +
        'background: transparent;';

      // Store font info for potential font loading
      span.dataset.fontName = item.fontName;
      
      fragment.appendChild(span);
      spansRef.current.set(index, span);
    });

    container.appendChild(fragment);
    setTextContentLoaded(true);
  }, [viewport, renderScale, pdfToCss, enableSelection]);

  // Re-render on viewport/text content changes
  useEffect(() => {
    if (textContentRef.current) {
      renderTextItems();
    }
  }, [viewport, renderScale, textContentLoaded, renderTextItems]);

  // Handle text content loading from pdf.js
  useEffect(() => {
    if (initialTextContent) {
      textContentRef.current = initialTextContent;
      onTextContent?.(initialTextContent);
      setTextContentLoaded(true);
    }
  }, [initialTextContent, onTextContent]);

  // Search highlighting
  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous highlights
    matchHighlightsRef.current.forEach(idx => {
      const span = spansRef.current.get(idx);
      if (span) span.classList.remove('text-layer__match', 'text-layer__match--current');
    });
    matchHighlightsRef.current.clear();

    if (!searchQuery || searchMatches.length === 0) return;

    // Apply new highlights
    searchMatches.forEach((matchIdx, i) => {
      const span = spansRef.current.get(matchIdx);
      if (span) {
        span.classList.add('text-layer__match');
        if (i === 0) span.classList.add('text-layer__match--current');
        matchHighlightsRef.current.add(matchIdx);
      }
    });

    // Scroll to first match
    const firstMatchSpan = spansRef.current.get(searchMatches[0]);
    if (firstMatchSpan && containerRef.current) {
      firstMatchSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [searchQuery, searchMatches, pdfToCss]);

  // Selection handling
  useEffect(() => {
    if (!enableSelection || !containerRef.current) return;

    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        selectionRef.current = null;
        onSelectionChange?.('', []);
        return;
      }

      const range = sel.getRangeAt(0);
      const container = containerRef.current;
      if (!container || !container.contains(range.commonAncestorContainer)) {
        return; // Selection outside text layer
      }

      selectionRef.current = sel;
      const text = sel.toString();
      
      // Get rects for selection
      const rects: DOMRect[] = [];
      for (let i = 0; i < sel.rangeCount; i++) {
        const r = sel.getRangeAt(i);
        rects.push(...r.getClientRects());
      }

      onSelectionChange?.(text, rects);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [enableSelection, onSelectionChange]);

  // Double-click to select word
  useEffect(() => {
    if (!enableSelection || !containerRef.current) return;

    const handleDblClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'SPAN' || !containerRef.current?.contains(target)) return;

      const range = document.createRange();
      range.selectNodeContents(target);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };

    const container = containerRef.current;
    container.addEventListener('dblclick', handleDblClick);
    return () => container?.removeEventListener('dblclick', handleDblClick);
  }, [enableSelection]);

  // Public API
  const getSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const text = sel.toString();
    const rects: DOMRect[] = [];
    for (let i = 0; i < sel.rangeCount; i++) {
      rects.push(...sel.getRangeAt(i).getClientRects());
    }
    return { text, rects };
  }, []);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    selectionRef.current = null;
    onSelectionChange?.('', []);
  }, [onSelectionChange]);

  const scrollToMatch = useCallback((index: number) => {
    const span = spansRef.current.get(searchMatches[index]);
    if (span && containerRef.current) {
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Update current match highlight
      matchHighlightsRef.current.forEach(idx => {
        spansRef.current.get(idx)?.classList.remove('text-layer__match--current');
      });
      span.classList.add('text-layer__match--current');
    }
  }, [searchMatches]);

  const getTextItems = useCallback(() => {
    return textContentRef.current?.items ?? [];
  }, []);

  // Expose ref methods
  useImperativeHandle(ref, () => ({
    getSelection,
    clearSelection,
    scrollToMatch,
    getTextItems,
  }), [getSelection, clearSelection, scrollToMatch, getTextItems]);

  return (
    <div
      ref={containerRef}
      className={`text-layer ${className}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${viewport?.width ?? 0}px`,
        height: `${viewport?.height ?? 0}px`,
        pointerEvents: enableSelection ? 'auto' : 'none',
        zIndex: 10,
      }}
      aria-hidden={!enableSelection}
    />
  );
});

export { TextLayer };
export type { TextLayerProps };