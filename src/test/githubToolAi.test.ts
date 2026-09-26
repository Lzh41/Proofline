import { describe, expect, it } from 'vitest';
import { buildGithubToolInstallPrompt, parseGithubToolInstallPlan } from '../lib/ai';
import type { GithubToolInspection } from '../types';

const inspection: GithubToolInspection = {
  repositoryUrl: 'https://github.com/example/demo',
  htmlUrl: 'https://github.com/example/demo',
  fullName: 'example/demo',
  owner: 'example',
  repo: 'demo',
  name: 'demo',
  description: '本地 Web 工具',
  defaultBranch: 'main',
  language: 'Python',
  stars: 1,
  files: ['README.md', 'install.ps1', 'launch.ps1'],
  readme: '# demo',
  setupFiles: [{ path: 'install.ps1', content: 'Write-Output ok' }],
};

describe('GitHub 工具安装助手', () => {
  it('提示词包含安全约束和仓库信息', () => {
    const prompt = buildGithubToolInstallPrompt({ inspection });
    expect(prompt).toContain('只能引用仓库内已经出现的相对文件路径');
    expect(prompt).toContain('example/demo');
    expect(prompt).toContain('install.ps1');
  });

  it('解析候选配置并拒绝绝对路径、外部服务地址', () => {
    const plan = parseGithubToolInstallPlan(JSON.stringify({
      name: 'Demo',
      description: '说明',
      installerPath: 'scripts/install.ps1',
      installerArgs: ['-Target', 'local'],
      launcherPath: 'launch.ps1',
      launcherArgs: ['--no-open'],
      workingDirectory: '.',
      serviceUrl: 'https://example.com/secret',
      confidence: 'high',
      installSteps: ['下载源码'],
      notes: ['需要确认端口'],
      requiresConfirmation: false,
    }), inspection.repositoryUrl);
    expect(plan.installerPath).toBe('scripts/install.ps1');
    expect(plan.installerArgs).toEqual(['-Target', 'local']);
    expect(plan.workingDirectory).toBeUndefined();
    expect(plan.serviceUrl).toBeUndefined();
    expect(plan.requiresConfirmation).toBe(true);
  });

  it('不会把 Python 或 Node 配置文件当作可执行脚本', () => {
    const plan = parseGithubToolInstallPlan(JSON.stringify({
      name: 'Demo',
      installerPath: 'setup.py',
      launcherPath: 'package.json',
      requiresConfirmation: true,
    }), inspection.repositoryUrl);
    expect(plan.installerPath).toBeUndefined();
    expect(plan.launcherPath).toBeUndefined();
  });

  it('无效 JSON 会给出可读错误', () => {
    expect(() => parseGithubToolInstallPlan('这不是 JSON', inspection.repositoryUrl)).toThrow('不是有效 JSON');
  });
});
