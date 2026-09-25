import type { VocabularyDifficulty, VocabularyPartOfSpeech, VocabularyWord } from '../lib/vocabulary';
import { PUBLIC_VOCABULARY_RECORDS, type PublicVocabularyRecord } from './vocabularyPublicCatalog';

type ExamTag = Exclude<VocabularyDifficulty, 'beginner' | 'intermediate' | 'advanced'>;

const SOURCE_LABELS: Record<string, string> = {
  ngsl: 'NGSL 1.2',
  nawl: 'NAWL 1.2',
  ngslSpoken: 'NGSL-S 1.2',
  oewn: 'Open English Wordnet 2025',
  ecdict: 'ECDICT',
  ipaDict: 'ipa-dict IPA',
};

function sourceLabel(record: PublicVocabularyRecord): string {
  return record.sources.map((source) => SOURCE_LABELS[source] ?? source).join(' + ');
}

function examTagsFor(record: PublicVocabularyRecord): ExamTag[] {
  const tags = new Set(record.examTags ?? []);
  if (record.sources.includes('nawl')) {
    tags.add('toefl');
    tags.add('ielts');
    tags.add('postgrad');
    tags.add('sat');
  }
  if (record.sources.includes('ngsl')) tags.add('sat');
  return [...tags];
}

function fallbackDefinition(record: PublicVocabularyRecord): string {
  return record.definitionEn || record.ecdictDefinition || '暂无公开英释，请结合中文义项和词形主动回忆。';
}

function displayMeaning(record: PublicVocabularyRecord): string {
  const raw = record.meaningZh?.trim() || record.definitionEn || record.word;
  return raw
    .split(/\r?\n|；/)
    .map((part) => part.replace(/^(?:n|v|vt|vi|adj|a|adv|ad|prep|conj|pron)\.\s*/i, '').trim())
    .filter(Boolean)
    .join('；');
}

/** 将公开词表的可追溯字段转换为应用内的可刷词条。 */
export function publicRecordToVocabularyWord(record: PublicVocabularyRecord): VocabularyWord {
  const meaning = displayMeaning(record);
  return {
    id: record.id,
    word: record.word,
    phonetic: record.phonetic,
    partOfSpeech: record.partOfSpeech as VocabularyPartOfSpeech,
    level: record.level,
    difficulty: record.difficulty,
    examTags: examTagsFor(record),
    meaning,
    definitionEn: fallbackDefinition(record),
    example: '',
    exampleTranslation: '',
    family: [],
    collocations: [],
    mnemonic: `自生成回忆提示：用“${record.word}”造一个与你今天经历有关的短句，再遮住释义主动回忆。`,
    source: `公开词库：${sourceLabel(record)}（考试方向按明确标签或学术/高频语料筛选，不代表官方大纲）`,
  };
}

export const PUBLIC_VOCABULARY_CATALOG: VocabularyWord[] = PUBLIC_VOCABULARY_RECORDS.map(publicRecordToVocabularyWord);
