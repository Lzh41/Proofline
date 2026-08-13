import type { Worker as TesseractWorker } from 'tesseract.js';

export const OCR_MAX_FILE_BYTES = 20 * 1024 * 1024;

export const OCR_ASSET_PATHS = {
  worker: 'ocr/worker.min.js',
  core: 'ocr/tesseract-core-simd-lstm.wasm.js',
  languageDirectory: 'ocr/lang/',
} as const;

export class OcrCancelledError extends Error {
  constructor() {
    super('截图识别已取消。');
    this.name = 'OcrCancelledError';
  }
}

export interface OfflineOcrTask {
  result: Promise<string>;
  cancel: () => Promise<void>;
}

export function recognizeProblemImage(
  file: File,
  onProgress?: (progress: number) => void,
): OfflineOcrTask {
  if (file.size > OCR_MAX_FILE_BYTES) throw new Error('单张截图不能超过 20 MB。');

  let worker: TesseractWorker | undefined;
  let cancelled = false;
  const cancel = async () => {
    cancelled = true;
    await worker?.terminate();
    worker = undefined;
  };

  const result = (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    if (cancelled) throw new OcrCancelledError();

    worker = await createWorker('chi_sim+eng', OEM.LSTM_ONLY, {
      workerPath: toAssetUrl(OCR_ASSET_PATHS.worker),
      corePath: toAssetUrl(OCR_ASSET_PATHS.core),
      langPath: toAssetUrl(OCR_ASSET_PATHS.languageDirectory),
      cacheMethod: 'readOnly',
      gzip: true,
      logger: (event) => {
        if (typeof event.progress === 'number') onProgress?.(Math.round(event.progress * 100));
      },
    });

    if (cancelled) {
      await worker.terminate();
      worker = undefined;
      throw new OcrCancelledError();
    }

    try {
      const recognition = await worker.recognize(file);
      if (cancelled) throw new OcrCancelledError();
      return recognition.data.text.trim();
    } finally {
      await worker?.terminate();
      worker = undefined;
    }
  })();

  return { result, cancel };
}

export function isOcrCancelled(error: unknown): error is OcrCancelledError {
  return error instanceof OcrCancelledError;
}

function toAssetUrl(path: string): string {
  const root = new URL('/', window.location.href);
  return new URL(path, root).href;
}
