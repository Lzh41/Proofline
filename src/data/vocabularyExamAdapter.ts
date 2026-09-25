import type { VocabularyPartOfSpeech, VocabularyWord } from '../lib/vocabulary';
import { ECDICT_EXAM_RECORDS } from './vocabularyExamRecords';

const PARTS_OF_SPEECH = new Set<VocabularyPartOfSpeech>([
  'noun', 'verb', 'adjective', 'adverb', 'conjunction', 'preposition', 'pronoun', 'other',
]);

/** Explicit third-party exam tags are kept separate from frequency-based level estimates. */
export const ECDICT_EXAM_VOCABULARY_CATALOG: VocabularyWord[] = ECDICT_EXAM_RECORDS.map((record) => ({
  id: `exam-${record.word}`,
  word: record.word,
  phonetic: record.phonetic,
  partOfSpeech: PARTS_OF_SPEECH.has(record.partOfSpeech as VocabularyPartOfSpeech)
    ? record.partOfSpeech as VocabularyPartOfSpeech
    : 'other',
  level: record.level,
  difficulty: record.difficulty,
  examTags: record.examTags,
  meaning: record.meaning,
  definitionEn: record.definitionEn,
  example: '',
  exampleTranslation: '',
  family: [],
  collocations: [],
  mnemonic: '把这个词放进一句与自己有关的短句；稍后遮住释义回忆，再隔天复习。',
  source: 'ECDICT 明确考试标签 + ipa-dict 音标（第三方学习词集，非官方考纲）',
}));
