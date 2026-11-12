// Lightweight lexical tools shared by the memory and the briefing.
// No embeddings: everything runs instantly on the user's device.

const STOPWORDS = new Set(
  (
    'a an the and or but if then so of to in on at by for with from as is are was were be been being ' +
    'it its this that these those i you he she we they me him her us them my your our their do does did ' +
    "have has had not no yes can could would should will shall may might must just what which who whom " +
    'how when where why there here about into over than too very also le la les un une des et ou de du ' +
    "en au aux est sont je tu il elle nous vous ils elles ce cette ces que qui quoi pour par sur dans pas ne"
  ).split(/\s+/)
);

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text) {
  return normalize(text)
    .split(' ')
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

// Very small suffix stripper so "contracts" matches "contract".
function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/**
 * Ranks documents against a query with TF-IDF cosine similarity.
 * @param {string} query
 * @param {Array<{id:any,text:string}>} docs
 * @returns {Array<{id:any,score:number}>} sorted best first, score > 0 only
 */
export function rank(query, docs) {
  const q = tokenize(query);
  if (!q.length || !docs.length) return [];
  const tokenized = docs.map((d) => tokenize(d.text));
  const df = new Map();
  for (const toks of tokenized) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  const n = docs.length;
  const idf = (t) => Math.log(1 + (n + 1) / ((df.get(t) || 0) + 1));
  const vec = (toks) => {
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Map();
    for (const [t, c] of tf) v.set(t, (1 + Math.log(c)) * idf(t));
    return v;
  };
  const norm = (v) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;
  const qv = vec(q);
  const qn = norm(qv);
  const out = [];
  tokenized.forEach((toks, i) => {
    const dv = vec(toks);
    let dot = 0;
    for (const [t, w] of qv) if (dv.has(t)) dot += w * dv.get(t);
    const score = dot / (qn * norm(dv));
    if (score > 0) out.push({ id: docs[i].id, score });
  });
  return out.sort((a, b) => b.score - a.score);
}

export function similarity(a, b) {
  const r = rank(a, [{ id: 0, text: b }]);
  return r.length ? r[0].score : 0;
}

export function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}
