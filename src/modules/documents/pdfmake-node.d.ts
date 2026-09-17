/**
 * The Node side of pdfmake, which `@types/pdfmake` does not describe.
 *
 * That package types the *browser* entry point — `createPdf`, which returns a
 * blob for download. On a server the entry point is the `PdfPrinter` class from
 * `pdfmake/src/printer`, and it has no published types, so the four members we
 * actually use are declared here rather than reaching for `any`.
 */
declare module 'pdfmake/src/printer' {
  import type {
    TDocumentDefinitions,
    TFontDictionary,
  } from 'pdfmake/interfaces';
  import type { Readable } from 'node:stream';

  /**
   * A PDFKit document stream. Narrowed to what rendering needs: pdfmake hands
   * back a readable that must be `end()`ed before it emits.
   */
  interface PdfKitDocument extends Readable {
    end(): void;
  }

  class PdfPrinter {
    constructor(fonts: TFontDictionary);
    createPdfKitDocument(definition: TDocumentDefinitions): PdfKitDocument;
  }

  export = PdfPrinter;
}
