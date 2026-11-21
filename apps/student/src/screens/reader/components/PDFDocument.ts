/**
 * PDFDocument - Wrapper for pdf.js document handling
 * Provides text content extraction, page rendering, and search capabilities
 * Compatible with pdfjs-dist 4.x
 */

// pdf.js types (compatible with pdfjs-dist 4.x)
export interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<any>;
  getMetadata(): Promise<{ info: any; metadata: any }>;
  getOutline(): Promise<any[]>;
  getAttachments(): Promise<any>;
  getPermissions(): Promise<number>;
  getJavaScript(): Promise<any>;
  getData(): Promise<Uint8Array>;
  cleanup(): void;
  destroy(): void;
}

export interface PDFPageProxy {
  pageNumber: number;
  rotate: number;
  userUnit: number;
  view: number[];
  getViewport(params: { scale: number; rotation?: number }): any;
  getTextContent(params?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }): Promise<any>;
  getAnnotations(params?: { intent?: string }): Promise<any[]>;
  getOperatorList(): Promise<any>;
  render(params: any): any;
  cleanup(): void;
}

export interface PDFViewport {
  width: number;
  height: number;
  scale: number;
  rotation: number;
  transform: (x: number, y: number) => { x: number; y: number };
  clone(params?: { scale?: number; rotation?: number; offsetX?: number; offsetY?: number }): any;
  convertToViewportPoint(x: number, y: number): { x: number; y: number };
  convertToViewportRectangle(rect: number[]): number[];
}

export interface TextContent {
  items: any[];
  styles: Record<string, any>;
}

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

export interface TextStyle {
  fontFamily: string;
  ascent: number;
  descent: number;
  vertical: boolean;
}

export interface RenderParameters {
  canvasContext: CanvasRenderingContext2D;
  viewport: any;
  intent?: string;
  transform?: number[];
  imageLayer?: any;
  canvasFactory?: any;
  annotationLayer?: any;
  annotationMode?: number;
  enableWebGL?: boolean;
  useProviderFonts?: boolean;
}

export interface RenderTask {
  promise: Promise<void>;
  cancel(): void;
}

export interface SearchResult {
  pageNumber: number;
  textItemIndex: number;
  matchText: string;
  offsetInItem: number;
  contextBefore: string;
  contextAfter: string;
}

export class PDFDocument {
  private doc: any = null;
  private pageCache: Map<number, any> = new Map();
  private textContentCache: Map<number, any> = new Map();
  private outlineCache: any[] = [];
  private src: string | Uint8Array | ArrayBuffer;

  constructor(src: string | Uint8Array | ArrayBuffer) {
    this.src = src;
  }

  async load(): Promise<void> {
    this.doc = await getDocument(this.src);
  }

  get numPages(): number {
    return this.doc?.numPages ?? 0;
  }

  async getPage(pageNumber: number): Promise<any> {
    if (!this.doc) throw new Error('Document not loaded');
    
    if (this.pageCache.has(pageNumber)) {
      return this.pageCache.get(pageNumber)!;
    }
    
    const page = await this.doc.getPage(pageNumber);
    this.pageCache.set(pageNumber, page);
    return page;
  }

  async getTextContent(pageNumber: number): Promise<any> {
    if (this.textContentCache.has(pageNumber)) {
      return this.textContentCache.get(pageNumber)!;
    }
    
    const page = await this.getPage(pageNumber);
    const textContent = await page.getTextContent({ 
      normalizeWhitespace: true,
      disableCombineTextItems: false 
    });
    this.textContentCache.set(pageNumber, textContent);
    return textContent;
  }

  async getViewport(pageNumber: number, scale: number = 1, rotation: number = 0): Promise<any> {
    const page = await this.getPage(pageNumber);
    return page.getViewport({ scale, rotation });
  }

  async renderPage(
    pageNumber: number,
    canvasContext: CanvasRenderingContext2D,
    scale: number = 1,
    rotation: number = 0
  ): Promise<void> {
    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation });
    
    const renderContext: any = {
      canvasContext,
      viewport,
      enableWebGL: true,
      useProviderFonts: true,
    };
    
    const renderTask = page.render(renderContext);
    await renderTask.promise;
  }

  async getOutline(): Promise<any[]> {
    if (!this.doc) throw new Error('Document not loaded');
    
    if (this.outlineCache.length > 0) return this.outlineCache;
    
    this.outlineCache = await this.doc.getOutline() ?? [];
    return this.outlineCache;
  }

  async getMetadata(): Promise<{ info: any; metadata: any }> {
    if (!this.doc) throw new Error('Document not loaded');
    return this.doc.getMetadata();
  }

  async search(query: string, options: { caseSensitive?: boolean; wholeWord?: boolean; pageRange?: [number, number] } = {}): Promise<any[]> {
    const { caseSensitive = false, wholeWord = false, pageRange } = options;
    const results: any[] = [];
    
    const startPage = pageRange?.[0] ?? 1;
    const endPage = pageRange?.[1] ?? this.numPages;
    
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(
      (wholeWord ? '\\b' : '') + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (wholeWord ? '\\b' : ''),
      flags
    );
    
    for (let i = startPage; i <= endPage; i++) {
      const textContent = await this.getTextContent(i);
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      
      let match;
      while ((match = regex.exec(pageText)) !== null) {
        let charOffset = 0;
        let matchItemIndex = -1;
        let matchOffsetInItem = 0;
        
        for (let j = 0; j < textContent.items.length; j++) {
          const item = textContent.items[j];
          const nextOffset = charOffset + item.str.length;
          if (match.index >= charOffset && match.index < nextOffset) {
            matchItemIndex = j;
            matchOffsetInItem = match.index - charOffset;
            break;
          }
          charOffset = nextOffset;
        }
        
        if (matchItemIndex >= 0) {
          results.push({
            pageNumber: i,
            textItemIndex: matchItemIndex,
            matchText: match[0],
            offsetInItem: matchOffsetInItem,
            contextBefore: pageText.slice(Math.max(0, match.index - 50), match.index),
            contextAfter: pageText.slice(match.index + match[0].length, match.index + match[0].length + 50),
          });
        }
        
        if (!regex.flags.includes('g')) break;
      }
    }
    
    return results;
  }

  destroy(): void {
    this.pageCache.forEach(page => page.cleanup());
    this.pageCache.clear();
    this.textContentCache.clear();
    this.outlineCache = [];
    this.doc?.destroy();
    this.doc = null;
  }
}

// Global pdf.js instance (loaded dynamically)
let pdfjsLib: any = null;
let pdfjsLoading: Promise<any> | null = null;

export async function loadPdfJS(): Promise<any> {
  if (typeof window === 'undefined') {
    return null;
  }
  
  if (pdfjsLib) return pdfjsLib;
  
  if (!pdfjsLoading) {
    pdfjsLoading = (async () => {
      const mod = await import('pdfjs-dist');
      // Set worker source
      if (typeof window !== 'undefined') {
        mod.GlobalWorkerOptions.workerSrc = `/student/pdf.worker.min.mjs`;
      }
      return mod;
    })();
  }
  
  return pdfjsLoading;
}

export async function getDocument(src: string | Uint8Array | ArrayBuffer): Promise<any> {
  const lib = await loadPdfJS();
  if (!lib) return null;
  const loadingTask = lib.getDocument({ data: src, cMapUrl: '/student/cmaps/', cMapPacked: true });
  return loadingTask.promise;
}

export function createPDFDocument(src: string | Uint8Array | ArrayBuffer): PDFDocument {
  return new PDFDocument(src);
}

// Helper to convert PDF point to CSS coordinates
export function pdfPointToCss(
  point: { x: number; y: number },
  viewport: any
): { x: number; y: number } {
  const transformed = viewport.transform(point.x, point.y);
  return {
    x: transformed.x,
    y: transformed.y,
  };
}

// Helper to convert CSS point to PDF coordinates
export function cssPointToPdf(
  point: { x: number; y: number },
  viewport: any
): { x: number; y: number } {
  return viewport.convertToViewportPoint(point.x, point.y);
}

export function createPDFDocumentFromSrc(src: string | Uint8Array | ArrayBuffer): PDFDocument {
  return new PDFDocument(src);
}