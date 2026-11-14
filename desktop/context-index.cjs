'use strict';
const { documentVersion } = require('./preparation.cjs');
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
    this.chunks = []; this.documents = new Map();
    for (const doc of [{ id: 'profile', name: '真实背景', text: notes }, ...documents]) {
      const text = String(doc.text || '');
      this.documents.set(doc.id, { ...doc, text, hash: documentVersion(text) });
      for (let at = 0; at < text.length; at += 800) {
        const part = text.slice(at, at + 1000);
        this.chunks.push({ name: doc.name, id: doc.id, at, text: part, terms: tokens(part) });
      }
    }
  }
  select(question, budget = 6000, { resumeDocumentId = '' } = {}) {
    const query = tokens(question), selected = [], sources = [], full = new Set(), ranges = new Map();
    let characters = 0;
    const append = (chunk, complete = false) => {
      const label = `资料：${chunk.name}（${complete ? '全文' : `片段 ${chunk.at + 1}`}）\n`;
      const room = budget - characters - label.length - 2;
      if (room < 80 || complete && room < chunk.text.length) return false;
      const text = chunk.text.slice(0, room);
      selected.push(label + text); characters += label.length + text.length + 2;
      sources.push({ id: chunk.id, name: chunk.name, hash: this.documents.get(chunk.id).hash, start: chunk.at + 1, end: chunk.at + text.length, complete: complete || chunk.at === 0 && text.length === this.documents.get(chunk.id)?.text.length });
      const used = ranges.get(chunk.id) || []; used.push([chunk.at, chunk.at + text.length]); ranges.set(chunk.id, used);
      return true;
    };
    const resume = this.documents.get(resumeDocumentId);
    if (resume?.text.trim() && resume.text.length <= 4000 && append({ ...resume, at: 0 }, true)) full.add(resume.id);
    const ranked = this.chunks.map((chunk, index) => {
      let score = 0;
      for (const term of query) if (chunk.terms.has(term)) score += /[a-z]/.test(term) ? 3 : 1;
      if (chunk.id === 'profile' || chunk.id === resumeDocumentId) score += 0.2;
      return { chunk, index, score };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    const first = new Map();
    for (const item of ranked) if (!first.has(item.chunk.id)) first.set(item.chunk.id, item);
    const order = [...first.values()].sort((a, b) => b.score - a.score).slice(0, 4).concat(ranked), used = new Set();
    for (const item of order) {
      const chunk = item.chunk;
      if (used.has(item.index) || full.has(chunk.id) || characters >= budget) continue;
      if ((ranges.get(chunk.id) || []).some(([start,end]) => chunk.at < end && chunk.at + chunk.text.length > start)) continue;
      if (append(chunk)) used.add(item.index);
    }
    return { text: `[STUDIO_CONTEXT]\n${selected.join('\n\n')}\n[END_STUDIO_CONTEXT]`, characters, chunks: sources.length, totalChunks: this.chunks.length, sources };
  }
}
module.exports = { ContextIndex, tokens };
