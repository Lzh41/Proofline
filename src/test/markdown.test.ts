import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../lib/markdown';

describe('Markdown 笔记渲染', () => {
  it('将常用 Markdown 编译为阅读结构', () => {
    const html = renderMarkdown('# 标题\n\n- 要点一\n- 要点二\n\n```cpp\nint main() {}\n```');
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<pre><code class="language-cpp">');
    expect(html).not.toContain('```');
  });

  it('清理危险 HTML 标签和脚本属性', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)">安全');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).toContain('安全');
  });
});
