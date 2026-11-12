// Extracts text from a briefing document, entirely in the browser.
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';

let workerSet = false;
export function setPdfWorker(url) {
  pdfjs.GlobalWorkerOptions.workerSrc = url;
  workerSet = true;
}

export async function extractText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    if (!workerSet) throw new Error('PDF reader not ready');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, 40); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
    }
    return pages.join('\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }
  if (file.size > 2_000_000) throw new Error('file too large (2 MB max)');
  return (await file.text()).trim();
}
