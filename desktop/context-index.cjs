'use strict';

function tokens(text) {
  const normalized = text.toLowerCase();
  const result = normalized.match(/[a-z0-9_+#.-]{2,}/g) || [];
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) || []) {
    if (run.length === 1) result.push(run);
    else for (let i = 0; i < run.length - 1; i++) result.push(run.slice(i, i + 2));
  }
  return new Set(result);
}

class ContextIndex {
  constructor(documents = [], notes = '') { this.reset(documents, notes); }
  reset(documents, notes) {
    this.chunks = [];
    for (const doc of [{ id: 'profile', name: '真实背景', text: notes }, ...documents]) {
      const text = String(doc.text || '');
      for (let at = 0; at < text.length; at += 800) {
        const part = text.slice(at, at + 1000);
        this.chunks.push({ name: doc.name, id: doc.id, at, text: part, terms: tokens(part) });
      }
    }
  }
  select(question, budget = 6000) {
    const query = tokens(question);
    const ranked = this.chunks.map((chunk, index) => {
      let score = 0;
      for (const term of query) if (chunk.terms.has(term)) score += /[a-z]/.test(term) ? 3 : 1;
      if (chunk.id === 'profile') score += 0.2;
      return { chunk, index, score };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    const selected = []; let characters = 0;
    // Reserve one relevant fragment per document before filling the remaining
    // budget by relevance, so a new résumé is not starved by old notes.
    const first = new Map();
    for (const item of ranked) if (!first.has(item.chunk.id)) first.set(item.chunk.id, item);
    const order = [...first.values()].sort((a, b) => b.score - a.score).slice(0, 4).concat(ranked);
    const used = new Set();
    for (const item of order) {
      if (used.has(item.index) || characters >= budget) continue;
      const label = `资料：${item.chunk.name}（片段 ${item.chunk.at + 1}）\n`;
      const room = budget - characters - label.length - 2;
      if (room < 80) break;
      const text = item.chunk.text.slice(0, room);
      selected.push(label + text); characters += label.length + text.length + 2; used.add(item.index);
    }
    return { text: `[STUDIO_CONTEXT]\n${selected.join('\n\n')}\n[END_STUDIO_CONTEXT]`, characters, chunks: selected.length, totalChunks: this.chunks.length };
  }
}

module.exports = { ContextIndex, tokens };
