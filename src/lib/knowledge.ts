import type { KnowledgeNote } from '../types';
import { normalizeText } from './ids';

export interface KnowledgeSearchResult {
  note: KnowledgeNote;
  score: number;
  highlights: string[];
}

export function searchKnowledge(notes: KnowledgeNote[], query: string): KnowledgeSearchResult[] {
  const terms = normalizeText(query).split(' ').filter(Boolean);
  if (!terms.length) return notes.map((note) => ({ note, score: 0, highlights: [] }));
  return notes.map((note) => {
    const title = normalizeText(note.title);
    const content = normalizeText(note.content);
    const tags = note.tags.map(normalizeText);
    let score = 0;
    const highlights: string[] = [];
    terms.forEach((term) => {
      if (title.includes(term)) { score += 8; highlights.push(note.title); }
      if (tags.some((tag) => tag.includes(term))) { score += 5; highlights.push(...note.tags.filter((tag) => normalizeText(tag).includes(term))); }
      const occurrences = content.split(term).length - 1;
      if (occurrences) { score += Math.min(occurrences, 5); highlights.push(term); }
    });
    return { note, score, highlights: [...new Set(highlights)] };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt);
}
