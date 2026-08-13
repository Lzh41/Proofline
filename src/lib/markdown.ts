import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: true,
});

/** 将用户或 AI 生成的 Markdown 编译为安全 HTML，避免原始符号直接出现在阅读页。 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source || '');
  return DOMPurify.sanitize(typeof html === 'string' ? html : '', {
    USE_PROFILES: { html: true },
  });
}
