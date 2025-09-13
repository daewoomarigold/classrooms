/***** CONFIG *****/
const START_AT = 3;               // slide 3 => pg. 1
const TAG = 'WORKBOOK_PAGE_NUMBER';

const MARGIN = 20;                // px from edges
const BOX_W = 70, BOX_H = 22;     // textbox size
const FONT_SIZE = 12;
const FONT_COLOR = '#9AA0A6';     // light gray

/***** MENU *****/
function onOpen() {
  SlidesApp.getUi()
    .createMenu('Workbook Pages')
    .addItem('Add page numbers', 'addWorkbookPageNumbers')
    .addItem('Remove page numbers', 'removeWorkbookPageNumbers')
    .addSeparator()
    .addItem('Regenerate (remove then add)', 'regenerateWorkbookPageNumbers')
    .addToUi();
}

/***** CORE *****/
function addWorkbookPageNumbers() {
  const pres = SlidesApp.getActivePresentation();
  const slides = pres.getSlides();
  const pageWidth = pres.getPageWidth();
  const pageHeight = pres.getPageHeight();
  const startIndex = START_AT - 1;

  for (let i = startIndex; i < slides.length; i++) {
    const slide = slides[i];
    const pageNumber = (i - startIndex) + 1; // slide START_AT => 1

    // Clean any existing page-number boxes on this slide (by tag)
    cleanupTaggedOnSlide_(slide);

    // Create box
    const box = slide.insertTextBox(`pg. ${pageNumber}`);
    box.setWidth(BOX_W);
    box.setHeight(BOX_H);
    if (typeof box.setTitle === 'function') box.setTitle(TAG);
    if (typeof box.setDescription === 'function') box.setDescription(TAG);

    // Style
    const tr = box.getText();
    tr.getTextStyle()
      .setFontSize(FONT_SIZE)
      .setForegroundColor(FONT_COLOR);

    const isOdd = pageNumber % 2 === 1;
    tr.getParagraphStyle().setParagraphAlignment(
      isOdd ? SlidesApp.ParagraphAlignment.END : SlidesApp.ParagraphAlignment.START
    );

    // Position
    const left = isOdd ? (pageWidth - BOX_W - MARGIN) : MARGIN;
    const top  = pageHeight - BOX_H - MARGIN;
    box.setLeft(left).setTop(top);

    // Send behind other elements (not behind slide background)
    if (typeof box.sendToBack === 'function') box.sendToBack();
  }
}

function removeWorkbookPageNumbers() {
  const pres = SlidesApp.getActivePresentation();
  pres.getSlides().forEach(slide => cleanupTaggedOnSlide_(slide));
}

function regenerateWorkbookPageNumbers() {
  removeWorkbookPageNumbers();
  addWorkbookPageNumbers();
}

/***** UTIL *****/
function cleanupTaggedOnSlide_(slide) {
  slide.getPageElements().forEach(el => {
    try {
      const title = (typeof el.getTitle === 'function') ? el.getTitle() : '';
      const desc  = (typeof el.getDescription === 'function') ? el.getDescription() : '';
      if (title === TAG || desc === TAG) el.remove();
    } catch (_) {
      // ignore elements that don't support title/description or removal
    }
  });
}
