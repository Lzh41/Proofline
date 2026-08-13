export function downloadTextFile(name: string, text: string): string {
  if (typeof document === 'undefined') throw new Error('当前环境不支持文件下载');
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return name;
}

export function chooseTextFile(accept = '.json,.xiti-backup.json'): Promise<string> {
  if (typeof document === 'undefined') return Promise.reject(new Error('当前环境不支持文件选择'));
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('未选择文件')); return; }
      file.text().then(resolve, reject);
    };
    input.click();
  });
}
