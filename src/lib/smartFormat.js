// "Smart formatting" — the tiny on-device line classifier (see
// /models/line-format, trained on Kaggle: all-MiniLM-L6-v2, int8 ONNX).
// It only ever adjusts the deterministic engine's ambiguous calls: speaker
// vs heading and verse-block membership. Everything else stays rule-driven.
let pipePromise = null;

const getPipeline = async () => {
  if (!pipePromise) {
    pipePromise = import('@huggingface/transformers').then(async (T) => {
      // The model is self-hosted from this app (public/models/line-format) —
      // never fetch it from the HF Hub. v3 resolves local files as
      // `localModelPath + <model-id>/`.
      T.env.allowLocalModels = true;
      T.env.allowRemoteModels = false;
      T.env.localModelPath = '/models/';
      // Single-threaded, no proxy worker: the threaded/asyncify wasm paths
      // fail to parse the session in non-isolated contexts.
      T.env.backends.onnx.wasm.numThreads = 1;
      T.env.backends.onnx.wasm.proxy = false;
      // Same-origin model; the HTTP cache is enough and the Cache API layer
      // has been observed to garble large responses in embedded webviews.
      T.env.useBrowserCache = false;
      return T.pipeline('text-classification', 'line-format', { dtype: 'q8' });
    }).catch((e) => { pipePromise = null; throw e; });
  }
  return pipePromise;
};

export async function isSmartFormatReady() {
  try {
    await getPipeline();
    return true;
  } catch {
    return false;
  }
}

// candidates: { lines, verseCandidates: Set<idx>, ambiguous: [idx] } from
// detectFormatCandidates(). Returns { verse, notVerse, speaker, notSpeaker }
// as Sets of line indices, or null when nothing needed the model.
export async function classifyLines(candidates) {
  const { lines, verseCandidates, ambiguous } = candidates;
  const targets = [];
  const seen = new Set();
  for (const idx of [...ambiguous, ...verseCandidates]) {
    if (seen.has(idx)) continue;
    seen.add(idx);
    const t = (lines[idx] || '').trim();
    if (t) targets.push({ idx, text: t });
  }
  if (!targets.length) return null;

  const cls = await getPipeline();
  const out = { verse: new Set(), notVerse: new Set(), speaker: new Set(), notSpeaker: new Set() };
  const BATCH = 64;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const res = await cls(batch.map((b) => b.text), { topk: 1 });
    batch.forEach((b, j) => {
      const r = Array.isArray(res) ? res[j] : res;
      if (!r) return;
      const { label, score } = r;
      const inVerse = verseCandidates.has(b.idx);
      if (label === 'verse') {
        (score > 0.55 ? out.verse : out.notVerse).add(b.idx);
      } else if (inVerse) {
        out.notVerse.add(b.idx);
      }
      if (label === 'speaker') {
        (score > 0.55 ? out.speaker : out.notSpeaker).add(b.idx);
      } else if (label === 'heading' && score > 0.7) {
        out.notSpeaker.add(b.idx);
      }
    });
  }
  return out;
}
