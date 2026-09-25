import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, '.tmp-oewn-2025');
const outputFile = path.join(root, 'src', 'data', 'vocabularyPublicCatalog.ts');

const readCsv = (fileName) => {
  const text = fs.readFileSync(path.join(root, fileName), 'utf8').replace(/^\uFEFF/, '').trim();
  const lines = text.split(/\r?\n/);
  const parseRow = (line) => {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        cells.push(cell);
        cell = '';
      } else {
        cell += char;
      }
    }
    cells.push(cell);
    return cells;
  };
  const headers = parseRow(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseRow(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
};

const ngsl = readCsv('.tmp-ngsl.csv');
const nawl = readCsv('.tmp-nawl.csv');
const ngslSpoken = readCsv('.tmp-ngsls.csv');
const spokenStats = readCsv('.tmp-ngsls-stats.csv');
const ecdictPath = process.env.PROOFLINE_ECDICT_JSON
  ?? path.join(root, '.tmp-ecdict-targets.json');
const ecdict = fs.existsSync(ecdictPath)
  ? (ecdictPath.toLocaleLowerCase().endsWith('.json')
    ? JSON.parse(fs.readFileSync(ecdictPath, 'utf8'))
    : readCsv(path.relative(root, ecdictPath)))
  : [];
const ipaDictUsPath = process.env.PROOFLINE_IPA_DICT_US
  ?? path.join(root, '.tmp-ipa-en_US.txt');
const ipaDictUkPath = process.env.PROOFLINE_IPA_DICT_UK
  ?? path.join(root, '.tmp-ipa-en_UK.txt');

const readIpaDict = (filePath) => {
  if (!fs.existsSync(filePath)) return new Map();
  const pronunciations = new Map();
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const separator = line.indexOf('\t');
    if (separator < 1) continue;
    const word = line.slice(0, separator).trim().toLocaleLowerCase('en-US');
    const phonetic = line.slice(separator + 1).trim();
    if (word && phonetic && !pronunciations.has(word)) pronunciations.set(word, phonetic);
  }
  return pronunciations;
};
const ipaDict = readIpaDict(ipaDictUsPath);
for (const [word, phonetic] of readIpaDict(ipaDictUkPath)) {
  if (!ipaDict.has(word)) ipaDict.set(word, phonetic);
}

const sourceMeta = {
  ngsl: {
    name: 'New General Service List',
    version: '1.2',
    url: 'https://www.newgeneralservicelist.com/new-general-service-list',
    fileUrl: 'https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv',
    license: 'CC BY-SA 4.0',
    attribution: 'Browne, C., Culligan, B., and Phillips, J. The New General Service List.',
    sha256: '2098BAB8955A120A9766C6282A51D7D578C6CB0A7D946600D2FFB73BA25A0B44',
  },
  nawl: {
    name: 'New Academic Word List',
    version: '1.2',
    url: 'https://www.newgeneralservicelist.com/new-academic-word-list',
    fileUrl: 'https://www.newgeneralservicelist.com/s/NAWL_12_with_en_definitions.csv',
    license: 'CC BY-SA 4.0',
    attribution: 'Browne, C. and Culligan, B. The New Academic Word List.',
    sha256: '2ECA6B402B2CD17A8A0CE79F0AB6880BEF8AF2F4DBAB38D045321CECAA3284A4',
  },
  ngslSpoken: {
    name: 'New General Service List Spoken',
    version: '1.2',
    url: 'https://www.newgeneralservicelist.com/ngsl-spoken',
    fileUrl: 'https://www.newgeneralservicelist.com/s/NGSL-Spoken_12_with_en_definitions.csv',
    statsFileUrl: 'https://www.newgeneralservicelist.com/s/NGSL-Spoken_12_stats.csv',
    license: 'CC BY-SA 4.0',
    attribution: 'Browne, C. and Culligan, B. The New General Service List Spoken.',
    sha256: '0A14606829C67F51A779B98966A47851F8BF4EAB5769FE7D017A56BD0D3C1C39',
    statsSha256: '07708940C50A07CAC4F507FD1E87BDD50081D7B87713A66A99BEB3C8C4D11AC8',
  },
  oewn: {
    name: 'Open English Wordnet',
    version: '2025 edition',
    url: 'https://github.com/globalwordnet/english-wordnet',
    fileUrl: 'https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025-json.zip',
    license: 'CC BY 4.0 plus Princeton WordNet License',
    attribution: 'Open English Wordnet Team and Princeton WordNet.',
    sha256: '7DCA5F6E2C39E6970E4997839DCF6E42FD281F3C2FAE0171D2192BAE8CFA4B51',
  },
  ecdict: {
    name: 'ECDICT 目标词条审计映射',
    version: '2026-09-25 audit export',
    url: 'https://github.com/skywind3000/ECDICT',
    fileUrl: 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
    auditFile: 'proofline-ecdict-targets-minimal-20260925.json',
    license: 'MIT（仓库）；上游字典组件与抓取资料的逐项再分发许可需核验',
    attribution: 'ECDICT by Linwei；请同时阅读 README 的上游来源说明。',
    sha256: '924977C722440298A9CFEDBFACF95C892E900CC0FA7577C34F91C7A68D0E2862',
    redistributionStatus: 'review-required',
  },
  ipaDict: {
    name: 'ipa-dict English pronunciation data',
    version: '2026-09-25 snapshot',
    url: 'https://github.com/open-dict-data/ipa-dict',
    usFileUrl: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt',
    ukFileUrl: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_UK.txt',
    license: 'MIT（项目）；英语 US 数据基于 cmudict-ipa（MIT），UK 兜底数据保留上游许可证要求',
    attribution: 'open-dict-data/ipa-dict；英语美式数据基于 lingz/cmudict-ipa。',
    usSha256: '2AF6F154A5C363275F052D1F85ACEDEF38ED185CA9745AA4314BE77F6B70DE67',
    ukSha256: '221394CAEF0CF723B4F2DF81A98AC33191293257B88AED5B1FB89466D3A0DC77',
  },
};

const posMap = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' };
const posPriority = ['n', 'v', 'a', 's', 'r'];
const oewnEntries = new Map();
for (const fileName of fs.readdirSync(sourceDir).filter((name) => /^entries-[a-z0-9]\.json$/.test(name))) {
  const entries = JSON.parse(fs.readFileSync(path.join(sourceDir, fileName), 'utf8'));
  for (const [word, entry] of Object.entries(entries)) {
    const key = word.toLocaleLowerCase('en-US').trim();
    if (!oewnEntries.has(key)) oewnEntries.set(key, entry);
  }
}

const synsets = new Map();
for (const fileName of fs.readdirSync(sourceDir).filter((name) => /^(?:noun|verb|adj|adv)\..+\.json$/.test(name))) {
  const values = JSON.parse(fs.readFileSync(path.join(sourceDir, fileName), 'utf8'));
  for (const [id, synset] of Object.entries(values)) {
    synsets.set(id, synset);
  }
}

const cleanDefinition = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const selectWordNet = (word) => {
  const entry = oewnEntries.get(word);
  if (!entry) return { definitions: [], phonetic: '', partOfSpeech: 'other' };
  const definitions = [];
  const pronunciations = [];
  for (const pos of posPriority) {
    const data = entry[pos];
    if (!data) continue;
    for (const pronunciation of data.pronunciation ?? []) {
      const value = cleanDefinition(pronunciation.value);
      if (value && !pronunciations.includes(value)) pronunciations.push(value);
    }
    for (const sense of data.sense ?? []) {
      const synset = synsets.get(sense.synset);
      for (const definition of synset?.definition ?? []) {
        const clean = cleanDefinition(definition);
        if (clean && !definitions.some((item) => item.definitionEn === clean)) {
          definitions.push({ definitionEn: clean, partOfSpeech: posMap[pos] ?? 'other' });
        }
      }
    }
  }
  return {
    definitions: definitions.slice(0, 3),
    phonetic: pronunciations[0] ?? '',
    partOfSpeech: definitions[0]?.partOfSpeech ?? 'other',
  };
};

const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};
const normalizeWord = (value) => String(value ?? '').trim().toLocaleLowerCase('en-US');
const cleanChinese = (value) => String(value ?? '')
  .replace(/\\r?\\n/g, '；')
  .replace(/\\s+/g, ' ')
  .replace(/[;；]+/g, '；')
  .replace(/^；|；$/g, '')
  .trim();
const hasChinese = (value) => /[\u3400-\u9fff]/.test(value);
const records = new Map();
const getRecord = (word) => {
  const normalized = normalizeWord(word);
  if (!normalized || !/^[a-z][a-z'-]*$/.test(normalized)) return undefined;
  if (!records.has(normalized)) {
    const wordNet = selectWordNet(normalized);
    records.set(normalized, {
      id: `public-${normalized.replace(/[^a-z0-9]+/g, '-')}`,
      word: normalized,
      definitionEn: wordNet.definitions.map((item) => item.definitionEn).join('; '),
      partOfSpeech: wordNet.partOfSpeech,
      phonetic: wordNet.phonetic,
      sources: wordNet.definitions.length || wordNet.phonetic ? ['oewn'] : [],
      level: 'B1',
      difficulty: 'intermediate',
    });
  }
  return records.get(normalized);
};
const addSource = (row, source, word) => {
  const record = getRecord(word);
  if (!record) return;
  if (!record.sources.includes(source)) record.sources.push(source);
  if (source === 'ngsl') {
    record.ngslRank = asNumber(row['SFI Rank']);
    record.ngslFrequencyPerMillion = asNumber(row['Adjusted Frequency per Million (U)']);
  } else if (source === 'nawl') {
    record.nawlDefinitionEn = cleanDefinition(row['English Definition']);
    record.nawlJapaneseMeaning = cleanDefinition(row['J Translation']);
    record.nawlPartOfSpeech = cleanDefinition(row.POS);
    if (!record.definitionEn && record.nawlDefinitionEn) record.definitionEn = record.nawlDefinitionEn;
    if (record.partOfSpeech === 'other') {
      const nawlPos = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', prep: 'preposition', conj: 'conjunction', pron: 'pronoun' };
      record.partOfSpeech = nawlPos[record.nawlPartOfSpeech] ?? 'other';
    }
  } else if (source === 'ngslSpoken') {
    record.ngslSpokenRank = asNumber(row.Rank);
    record.ngslSpokenFrequencyPerMillion = asNumber(row.U);
    record.ngslSpokenDefinitionEn = cleanDefinition(row.Definition);
    if (!record.definitionEn && record.ngslSpokenDefinitionEn) record.definitionEn = record.ngslSpokenDefinitionEn;
  }
};
for (const row of ngsl) addSource(row, 'ngsl', row.Lemma);
for (const row of nawl) addSource(row, 'nawl', row.Meanings);
for (const row of ngslSpoken) addSource(row, 'ngslSpoken', row.Word);
for (const row of spokenStats) {
  const record = getRecord(row.Lemma);
  if (!record) continue;
  record.ngslSpokenRank = asNumber(row.Rank);
  record.ngslSpokenFrequencyPerMillion = asNumber(row.U);
  if (!record.sources.includes('ngslSpoken')) record.sources.push('ngslSpoken');
}
for (const row of ecdict) {
  const record = records.get(normalizeWord(row.word));
  if (!record) continue;
  const translation = cleanChinese(row.translation ?? row.meaning);
  if (!translation || !hasChinese(translation)) continue;
  record.meaningZh = translation;
  record.ecdictDefinition = cleanDefinition(row.definition ?? row.definitionEn);
  record.ecdictPos = cleanDefinition(row.pos ?? row.partOfSpeech);
  record.ecdictTags = Array.isArray(row.ecdictTags)
    ? row.ecdictTags.filter(Boolean)
    : cleanDefinition(row.tag ?? row.ecdictTags).split(/\s+/).filter(Boolean);
  const allowedExamTags = new Set(['cet4', 'cet6', 'toefl', 'ielts', 'postgrad', 'sat']);
  const derivedExamTags = Array.isArray(row.examTags) ? row.examTags : record.ecdictTags;
  record.examTags = derivedExamTags.filter((tag) => allowedExamTags.has(tag));
  if (!record.phonetic && row.phonetic) record.phonetic = cleanDefinition(row.phonetic);
  if (record.partOfSpeech === 'other') {
    const ecdictPos = { n: 'noun', v: 'verb', a: 'adjective', adj: 'adjective', ad: 'adverb', adv: 'adverb', prep: 'preposition', conj: 'conjunction', pron: 'pronoun', noun: 'noun', verb: 'verb', adjective: 'adjective', adverb: 'adverb' };
    record.partOfSpeech = ecdictPos[record.ecdictPos] ?? 'other';
  }
  if (!record.sources.includes('ecdict')) record.sources.push('ecdict');
}

// 统一使用 IPA-Dict 的宽式 IPA；美式表缺失的词形由英式表补齐，避免旧式 ASCII 拼读或空值泄露词面。
for (const record of records.values()) {
  const phonetic = ipaDict.get(record.word);
  if (!phonetic) continue;
  record.phonetic = phonetic;
  if (!record.sources.includes('ipaDict')) record.sources.push('ipaDict');
}

const classify = (record) => {
  const rank = record.ngslRank ?? record.ngslSpokenRank;
  if (record.sources.includes('nawl') && rank === undefined) return { level: 'B2', difficulty: 'intermediate' };
  if (rank !== undefined && rank <= 1000) return { level: 'A2', difficulty: 'beginner' };
  if (rank !== undefined && rank <= 2000) return { level: 'B1', difficulty: 'intermediate' };
  if (rank !== undefined && rank <= 4000) return { level: 'B2', difficulty: 'intermediate' };
  return { level: 'C1', difficulty: 'advanced' };
};
for (const record of records.values()) Object.assign(record, classify(record));

const ordered = [...records.values()].sort((left, right) => left.word.localeCompare(right.word));
const json = JSON.stringify(ordered, null, 2)
  .replace(/"([a-zA-Z_$][\w$]*)":/g, '$1:')
  .replace(/: null/g, ': undefined');
const header = `/* eslint-disable */\n/**\n * 公开许可词库目录，依据源表自动生成。\n *\n * 这份目录只保留可追溯的词头、英释、词性、音标和原始榜单信息；不把模板句子冒充词典例句。\n * CEFR/学习难度是按榜单位置推导的产品筛选值，不是来源方的官方考试分级。\n * 中文义项需由具有明确授权的双语词典补齐；NAWL 的日文义项仅作为原始字段保留。\n */\nimport type { VocabularyDifficulty, VocabularyLevel, VocabularyPartOfSpeech } from '../lib/vocabulary';\n\nexport type PublicVocabularySourceId = 'ngsl' | 'nawl' | 'ngslSpoken';\n\nexport interface PublicVocabularyRecord {\n  id: string;\n  word: string;\n  definitionEn: string;\n  partOfSpeech: VocabularyPartOfSpeech;\n  phonetic: string;\n  sources: PublicVocabularySourceId[];\n  level: VocabularyLevel;\n  difficulty: Extract<VocabularyDifficulty, 'beginner' | 'intermediate' | 'advanced'>;\n  ngslRank?: number;\n  ngslFrequencyPerMillion?: number;\n  ngslSpokenRank?: number;\n  ngslSpokenFrequencyPerMillion?: number;\n  nawlDefinitionEn?: string;\n  nawlJapaneseMeaning?: string;\n  nawlPartOfSpeech?: string;\n}\n\nexport const PUBLIC_VOCABULARY_LICENSES = ${JSON.stringify(sourceMeta, null, 2)} as const;\n\nexport const PUBLIC_VOCABULARY_RECORDS: readonly PublicVocabularyRecord[] = ${json};\n\nexport const PUBLIC_VOCABULARY_STATS = {\n  recordCount: PUBLIC_VOCABULARY_RECORDS.length,\n  sourceCounts: {\n    ngsl: PUBLIC_VOCABULARY_RECORDS.filter((word) => word.sources.includes('ngsl')).length,\n    nawl: PUBLIC_VOCABULARY_RECORDS.filter((word) => word.sources.includes('nawl')).length,\n    ngslSpoken: PUBLIC_VOCABULARY_RECORDS.filter((word) => word.sources.includes('ngslSpoken')).length,\n  },\n  withEnglishDefinition: PUBLIC_VOCABULARY_RECORDS.filter((word) => Boolean(word.definitionEn)).length,\n  withWordNetDefinition: PUBLIC_VOCABULARY_RECORDS.filter((word) => word.definitionEn.length > 0).length,\n  withChineseMeaning: 0,\n} as const;\n`;
const finalHeader = header
  .replace(' * 中文义项需由具有明确授权的双语词典补齐；NAWL 的日文义项仅作为原始字段保留。', ' * 中文义项在提供 ECDICT 审计映射时保留；ECDICT 上游来源链需人工核验，NAWL 的日文义项仅作为原始字段保留。')
  .replace("export type PublicVocabularySourceId = 'ngsl' | 'nawl' | 'ngslSpoken';", "export type PublicVocabularySourceId = 'ngsl' | 'nawl' | 'ngslSpoken' | 'oewn' | 'ecdict' | 'ipaDict';")
  .replace("  nawlPartOfSpeech?: string;\n", "  nawlPartOfSpeech?: string;\n  meaningZh?: string;\n  ecdictDefinition?: string;\n  ecdictPos?: string;\n  ecdictTags?: string[];\n")
  .replace("  ecdictTags?: string[];\n", "  ecdictTags?: string[];\n  examTags?: Array<'cet4' | 'cet6' | 'toefl' | 'ielts' | 'postgrad' | 'sat'>;\n")
  .replace("  withChineseMeaning: 0,", "  withChineseMeaning: PUBLIC_VOCABULARY_RECORDS.filter((word) => Boolean(word.meaningZh)).length,")
  .replace("  withWordNetDefinition: PUBLIC_VOCABULARY_RECORDS.filter((word) => word.definitionEn.length > 0).length,\n", "  withWordNetDefinition: PUBLIC_VOCABULARY_RECORDS.filter((word) => word.sources.includes('oewn')).length,\n  withPhonetic: PUBLIC_VOCABULARY_RECORDS.filter((word) => Boolean(word.phonetic)).length,\n  withExamTags: PUBLIC_VOCABULARY_RECORDS.filter((word) => (word.examTags?.length ?? 0) > 0).length,\n")
  .replace("  ngslSpokenFrequencyPerMillion?: number;\n", "  ngslSpokenFrequencyPerMillion?: number;\n  ngslSpokenDefinitionEn?: string;\n")
  .replace("    ngslSpoken: PUBLIC_VOCABULARY_RECORDS.filter((word) => word.sources.includes('ngslSpoken')).length,\n", "    ngslSpoken: PUBLIC_VOCABULARY_RECORDS.filter((word) => word.sources.includes('ngslSpoken')).length,\n    oewn: PUBLIC_VOCABULARY_RECORDS.filter((word) => word.sources.includes('oewn')).length,\n    ecdict: PUBLIC_VOCABULARY_RECORDS.filter((word) => word.sources.includes('ecdict')).length,\n    ipaDict: PUBLIC_VOCABULARY_RECORDS.filter((word) => word.sources.includes('ipaDict')).length,\n");
fs.writeFileSync(outputFile, finalHeader, 'utf8');
console.log(JSON.stringify({ outputFile, recordCount: ordered.length, withEnglishDefinition: ordered.filter((record) => record.definitionEn).length, withChineseMeaning: ordered.filter((record) => record.meaningZh).length, withPhonetic: ordered.filter((record) => record.phonetic).length, sourceCounts: Object.fromEntries(['ngsl', 'nawl', 'ngslSpoken', 'oewn', 'ecdict', 'ipaDict'].map((source) => [source, ordered.filter((record) => record.sources.includes(source)).length])) }, null, 2));
