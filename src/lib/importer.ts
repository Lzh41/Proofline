import type { AppDataSnapshot, ImportResult, Problem } from '../types';
import { normalizeSnapshot } from './data';
import { normalizeText, uniqueStrings } from './ids';

function problemKey(problem: Problem): string {
  // 平台题号比页面查询参数和尾斜杠更稳定，优先用于批量同步去重。
  if ((problem.source === 'leetcode-cn' || problem.source === 'leetcode' || problem.source === 'nowcoder') && problem.externalId) {
    return `external:${problem.kind}:${problem.source}:${normalizeText(problem.externalId)}`;
  }
  if (problem.sourceUrl) {
    try {
      const url = new URL(problem.sourceUrl);
      url.hash = '';
      url.search = '';
      return `url:${problem.kind}:${url.toString().replace(/\/$/, '')}`;
    } catch { /* use remaining identities */ }
  }
  if (problem.externalId) return `external:${problem.kind}:${problem.source}:${normalizeText(problem.externalId)}`;
  return `title:${problem.kind}:${problem.source}:${normalizeText(problem.title)}`;
}

function mergeProblem(existing: Problem, incoming: Problem): Problem {
  const incomingIsFresh = incoming.cacheStatus === 'fresh';
  const existingIsLinkOnly = existing.cacheStatus === 'link-only';
  return {
    ...incoming,
    ...existing,
    title: existing.title || incoming.title,
    content: existing.content || incoming.content,
    difficulty: existing.difficulty === 'unknown' ? incoming.difficulty : existing.difficulty,
    constraints: uniqueStrings([...existing.constraints, ...incoming.constraints]),
    tags: uniqueStrings([...existing.tags, ...incoming.tags]),
    examples: existing.examples.length ? existing.examples : incoming.examples,
    // 新鲜平台数据中的模板是官方函数签名，优先覆盖历史残留的错误模板；个人代码保存在 Attempt，不会被覆盖。
    codeSnippets: incomingIsFresh && incoming.codeSnippets?.length
      ? incoming.codeSnippets
      : existing.codeSnippets?.length ? existing.codeSnippets : incoming.codeSnippets,
    sampleTestCase: existing.sampleTestCase || incoming.sampleTestCase,
    cacheStatus: existingIsLinkOnly && incomingIsFresh ? 'fresh' : existing.cacheStatus,
    importMethod: existingIsLinkOnly && incomingIsFresh ? 'connector' : existing.importMethod,
    contentFetchedAt: incoming.contentFetchedAt ?? existing.contentFetchedAt,
    contentHash: incoming.contentHash ?? existing.contentHash,
    connectorVersion: incoming.connectorVersion ?? existing.connectorVersion,
    attachments: existing.attachments,
    interview: existing.interview || incoming.interview ? {
      ...(incoming.interview ?? existing.interview!),
      ...(existing.interview ?? {}),
      roles: uniqueStrings([...(incoming.interview?.roles ?? []), ...(existing.interview?.roles ?? [])]),
      keyPoints: uniqueStrings([...(incoming.interview?.keyPoints ?? []), ...(existing.interview?.keyPoints ?? [])]),
      followUps: uniqueStrings([...(incoming.interview?.followUps ?? []), ...(existing.interview?.followUps ?? [])]),
      referenceAnswer: existing.interview?.referenceAnswer || incoming.interview?.referenceAnswer || '',
    } : undefined,
    createdAt: Math.min(existing.createdAt, incoming.createdAt),
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  };
}

function mergeById<T extends { id: string; updatedAt?: number }>(current: T[], incoming: T[]) {
  const values = new Map(current.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  incoming.forEach((item) => {
    const existing = values.get(item.id);
    if (!existing) { values.set(item.id, item); added += 1; return; }
    if ((item.updatedAt ?? 0) > (existing.updatedAt ?? 0)) { values.set(item.id, { ...existing, ...item } as T); updated += 1; }
    else skipped += 1;
  });
  return { values: [...values.values()], added, updated, skipped };
}

export function importSnapshot(currentInput: AppDataSnapshot, incomingInput: unknown): ImportResult {
  const current = normalizeSnapshot(currentInput);
  const incoming = normalizeSnapshot(incomingInput);
  const problemMap = new Map(current.problems.map((item) => [problemKey(item), item]));
  let problemAdded = 0;
  let problemUpdated = 0;
  let problemSkipped = 0;
  incoming.problems.forEach((problem) => {
    const key = problemKey(problem);
    const existing = problemMap.get(key);
    if (!existing) { problemMap.set(key, problem); problemAdded += 1; }
    else {
      const merged = mergeProblem(existing, problem);
      problemMap.set(key, merged);
      if (JSON.stringify(merged) === JSON.stringify(existing)) problemSkipped += 1;
      else problemUpdated += 1;
    }
  });
  const attempts = mergeById(current.attempts, incoming.attempts);
  const thoughts = mergeById(current.thoughtEvents, incoming.thoughtEvents);
  const results = mergeById(current.platformResults, incoming.platformResults);
  const mistakes = mergeById(current.mistakes, incoming.mistakes);
  const notes = mergeById(current.knowledgeNotes, incoming.knowledgeNotes);
  const templates = mergeById(current.codeTemplates, incoming.codeTemplates);
  const plans = mergeById(current.dailyPlans, incoming.dailyPlans);
  const generations = mergeById(current.aiGenerations, incoming.aiGenerations);
  const snapshot: AppDataSnapshot = {
    ...current,
    problems: [...problemMap.values()],
    attempts: attempts.values,
    thoughtEvents: thoughts.values,
    platformResults: results.values,
    mistakes: mistakes.values,
    knowledgeNotes: notes.values,
    codeTemplates: templates.values,
    dailyPlans: plans.values,
    aiGenerations: generations.values,
    settings: { ...incoming.settings, ...current.settings, hasAiCredential: current.settings.hasAiCredential },
    updatedAt: Date.now(),
  };
  const entities = { problems: [problemAdded, problemUpdated, problemSkipped], attempts: [attempts.added, attempts.updated, attempts.skipped], thoughts: [thoughts.added, thoughts.updated, thoughts.skipped], results: [results.added, results.updated, results.skipped], mistakes: [mistakes.added, mistakes.updated, mistakes.skipped], notes: [notes.added, notes.updated, notes.skipped], templates: [templates.added, templates.updated, templates.skipped], plans: [plans.added, plans.updated, plans.skipped], generations: [generations.added, generations.updated, generations.skipped] };
  return {
    snapshot,
    added: Object.fromEntries(Object.entries(entities).map(([key, value]) => [key, value[0]])),
    updated: Object.fromEntries(Object.entries(entities).map(([key, value]) => [key, value[1]])),
    skipped: Object.fromEntries(Object.entries(entities).map(([key, value]) => [key, value[2]])),
  };
}
