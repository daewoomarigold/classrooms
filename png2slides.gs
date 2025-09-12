/**
 * Prompts for a Google Drive folder URL or ID, then inserts
 * one image per slide (centered, fit-to-slide) in natural order.
 */
function importFromFolderPrompt() {
  const ui = SlidesApp.getUi();
  const resp = ui.prompt(
    'Folder URL or ID',
    'Paste the Google Drive *folder* URL (or just its ID). ' +
    'Tip: open the folder first, then copy the URL after it loads.',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  const raw = (resp.getResponseText() || '').trim();
  if (!raw) { ui.alert('No input provided.'); return; }

  let folderId;
  try {
    folderId = extractFolderId_(raw);
    // If you pasted a shortcut link/ID, Drive will still throw. We catch and explain below.
    DriveApp.getFolderById(folderId); // sanity check for permissions/existence
  } catch (e) {
    ui.alert(
      'Could not open that folder.\n\nCommon causes:\n' +
      '• You pasted a *file* or *shortcut* link, not a real folder link\n' +
      '• You pasted the whole URL from a preview page that hasn’t fully redirected\n' +
      '• You don’t have permission to the folder\n\n' +
      'Details: ' + e
    );
    return;
  }

  importFolderImagesToSlides_(folderId, {
    includeSubfolders: true,
    clearExistingSlides: true,
    marginPts: 24
  });
}

/** Extracts a plausible Drive ID (handles full URLs or bare IDs). */
function extractFolderId_(text) {
  // Works for: .../folders/<ID>, ...open?id=<ID>, or a bare ID
  const m = String(text).match(/[-\w]{25,}/);
  if (!m) throw new Error('No Drive resource ID found in input.');
  return m[0];
}

/**
 * Core importer: reads images from folderId, sorts naturally,
 * creates one blank slide per image, fits + centers each image.
 */
function importFolderImagesToSlides_(folderId, opts) {
  const ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
  const includeSub = !!opts?.includeSubfolders;
  const clear = !!opts?.clearExistingSlides;
  const margin = Number(opts?.marginPts ?? 24);

  const pres = SlidesApp.getActivePresentation();
  if (clear) {
    const slides = pres.getSlides();
    for (let i = slides.length - 1; i >= 0; i--) slides[i].remove();
  }

  const pageW = pres.getPageWidth();
  const pageH = pres.getPageHeight();

  const files = [];
  const startFolder = DriveApp.getFolderById(folderId);

  function walk(folder, prefix) {
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      const name = f.getName();
      const ext = name.split('.').pop().toLowerCase();
      if (ALLOWED_EXTS.includes(ext)) {
        files.push({ file: f, key: prefix + name });
      }
    }
    if (includeSub) {
      const subs = folder.getFolders();
      while (subs.hasNext()) {
        const sub = subs.next();
        walk(sub, prefix + sub.getName() + '/');
      }
    }
  }
  walk(startFolder, '');

  if (files.length === 0) {
    SlidesApp.getUi().alert('No images found in that folder (or subfolders).');
    return;
  }

  files.sort((a, b) => naturalCompare_(a.key, b.key));

  files.forEach(({ file, key }, index) => {
  const slide = pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
  const img = slide.insertImage(file.getBlob());

  // Fit to slide with margin (preserve aspect), don’t upscale above 100%
  const maxW = pageW - 2 * margin;
  const maxH = pageH - 2 * margin;
  const iw = img.getWidth(), ih = img.getHeight();
  const scale = Math.min(maxW / iw, maxH / ih, 1);

  const newW = iw * scale, newH = ih * scale;
  img.setWidth(newW).setHeight(newH);
  img.setLeft((pageW - newW) / 2).setTop((pageH - newH) / 2);

  // Keep source path in slide notes
  slide.getNotesPage().getSpeakerNotesShape().getText().setText(key);

  // === NEW: write to execution log ===
  console.log("Page " + (index + 1) + " added (" + key + ")");
});


  SlidesApp.getUi().alert('Inserted ' + files.length + ' image(s).');
}

/** Case-insensitive, numeric-aware comparator (…-2 < …-10). */
function naturalCompare_(a, b) {
  const ax = a.toLowerCase().match(/(\d+|\D+)/g) || [a.toLowerCase()];
  const bx = b.toLowerCase().match(/(\d+|\D+)/g) || [b.toLowerCase()];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    if (ax[i] === undefined) return -1;
    if (bx[i] === undefined) return 1;
    const an = parseInt(ax[i], 10), bn = parseInt(bx[i], 10);
    const aNum = !isNaN(an), bNum = !isNaN(bn);
    if (aNum && bNum && an !== bn) return an - bn;
    if (!aNum || !bNum) {
      if (ax[i] !== bx[i]) return ax[i].localeCompare(bx[i]);
    }
  }
  return 0;
}
