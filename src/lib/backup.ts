import type { AppDataSnapshot, BackupManifest } from '../types';

export function createBackupManifest(snapshot: AppDataSnapshot, appVersion = '0.1.0', now = Date.now()): BackupManifest {
  return {
    format: 'xiti-backup',
    version: 1,
    createdAt: now,
    appVersion,
    entityCounts: {
      problems: snapshot.problems.length,
      algorithmProblems: snapshot.problems.filter((item) => item.kind !== 'interview').length,
      interviewQuestions: snapshot.problems.filter((item) => item.kind === 'interview').length,
      attempts: snapshot.attempts.length,
      interviewAttempts: snapshot.attempts.filter((item) => item.mode === 'interview').length,
      thoughtEvents: snapshot.thoughtEvents.length,
      platformResults: snapshot.platformResults.length,
      mistakes: snapshot.mistakes.length,
      knowledgeNotes: snapshot.knowledgeNotes.length,
      codeTemplates: snapshot.codeTemplates.length,
      dailyPlans: snapshot.dailyPlans.length,
      aiGenerations: snapshot.aiGenerations.length,
    },
    includesCredentials: false,
    includesPlatformCookies: false,
  };
}

export function serializeExport(snapshot: AppDataSnapshot): string {
  const safeSnapshot = { ...snapshot, settings: { ...snapshot.settings, hasAiCredential: false } };
  return JSON.stringify({ manifest: createBackupManifest(safeSnapshot), snapshot: safeSnapshot }, null, 2);
}

export function parseExport(text: string): AppDataSnapshot {
  const value = JSON.parse(text) as { manifest?: BackupManifest; snapshot?: AppDataSnapshot } | AppDataSnapshot;
  if ('snapshot' in value && value.snapshot) {
    if (value.manifest?.format !== 'xiti-backup') throw new Error('不是有效的 Proofline 备份文件');
    return value.snapshot;
  }
  return value as AppDataSnapshot;
}
