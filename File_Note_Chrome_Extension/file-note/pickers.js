// File pickers that start in a useful folder (File System Access API).
// undefined = unavailable, so the caller falls back to <input type="file"> / a download; null = cancelled.
const cancelled = (e) => e?.name === 'AbortError';

async function show(name, options) {
  if (typeof window[name] !== 'function') return undefined;
  try {
    return await window[name](options);
  } catch (e) {
    if (cancelled(e)) return null;
    if (options.startIn && e?.name === 'TypeError') return show(name, { ...options, startIn: undefined });
    return undefined;
  }
}

// Opens in the Pictures folder the first time, then in the folder used last.
export async function pickPhoto() {
  const picked = await show('showOpenFilePicker', {
    id: 'file-note-photo',
    startIn: 'pictures',
    types: [{ description: '写真', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] } }],
  });
  // Keep null (cancelled) apart from undefined (unavailable): only the latter may open the fallback.
  return picked ? picked[0].getFile() : picked;
}

export async function pickPdf() {
  const picked = await show('showOpenFilePicker', {
    id: 'file-note-open',
    types: [
      {
        description: 'PDF・Word・PowerPoint・編集データ',
        accept: {
          'application/pdf': ['.pdf'],
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
          'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
          'application/json': ['.filenote'],
        },
      },
    ],
  });
  if (!picked) return picked;
  return { handle: picked[0], file: await picked[0].getFile() };
}
