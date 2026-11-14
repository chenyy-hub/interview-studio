'use strict';
const crypto = require('node:crypto');
const DEFAULTS = Object.freeze({ company: '', role: '', jobDescription: '', resumeDocumentId: '', language: 'Chinese', style: 'natural', programmingLanguage: 'auto' });
function preparation(value = {}, defaults = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('面试准备格式不正确');
  const result = { ...DEFAULTS, ...defaults };
  for (const [name, maximum] of Object.entries({ company: 100, role: 150, jobDescription: 12000, resumeDocumentId: 100 })) {
    const text = value[name] ?? result[name];
    if (typeof text !== 'string' || text.length > maximum) throw new Error(`面试准备中的 ${name} 内容过长或格式不正确`);
    result[name] = text.trim();
  }
  for (const [name, allowed] of Object.entries({ language: ['Chinese','English'], style: ['natural','structured'], programmingLanguage: ['auto','C','C++','Python','Java','JavaScript','TypeScript','Go','Rust','C#','SQL'] })) {
    const setting = value[name] ?? result[name];
    if (!allowed.includes(setting)) throw new Error('请选择支持的回答语言、风格和编程语言');
    result[name] = setting;
  }
  return result;
}
function preparationContext(value, limit = 1500) {
  const facts = [value.company && `目标公司：${value.company}`, value.role && `目标岗位：${value.role}`, value.jobDescription && `岗位描述：\n${value.jobDescription.slice(0, limit)}`].filter(Boolean);
  return facts.length ? '\n\n[INTERVIEW_PREPARATION]\n' + facts.join('\n') + '\n[END_INTERVIEW_PREPARATION]' : '';
}
function documentHash(text) { return crypto.createHash('sha256').update(text.normalize('NFC').replace(/\r\n?/g, '\n').trim()).digest('hex'); }
function documentVersion(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
module.exports = { preparation, preparationContext, documentHash, documentVersion, DEFAULTS };
