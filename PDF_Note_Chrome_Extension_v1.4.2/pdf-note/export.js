// Annotations use the displayed page's coordinate system (top-left origin).
// A separate vector PDF layer is embedded into the unmodified original page.
import { assemblePdf } from './pages.js';
export async function buildPdf({ sources, pages, annotations, dimensions, fontBytes, formValues = {} }) {
  const { PDFDocument, rgb, degrees, LineCapStyle } = globalThis.PDFLib;
  const output = await assemblePdf({sources,pages,formValues,fontBytes});
  const layer = await PDFDocument.create();
  const hasText = annotations.some(list => list?.some(o => o.type === 'text'));
  let font;
  if (hasText) {
    layer.registerFontkit(globalThis.fontkit);
    // Full embedding keeps Noto Sans JP glyphs reliable across PDF viewers.
    font = await layer.embedFont(fontBytes, { subset: false });
  }
  const color = hex => rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);
  const layers = [];
  for (let index = 0; index < annotations.length; index++) {
    const objects = annotations[index];
    if (!objects?.length) continue;
    const {width,height} = dimensions[index];
    const p = layer.addPage([width,height]);
    for (const o of objects) {
      if (o.type === 'text') {
        for (const [lineIndex,line] of o.text.split('\n').entries()) {
          p.drawText(line, { x:o.x, y:height-o.y-o.size-lineIndex*o.size*1.35, size:o.size, font, color:color(o.color) });
        }
      } else if (o.type === 'image') {
        const image = o.data.startsWith('data:image/png') ? await layer.embedPng(o.data) : await layer.embedJpg(o.data);
        p.drawImage(image, {x:o.x,y:height-o.y-o.h,width:o.w,height:o.h});
      } else if (o.type === 'line' || o.type === 'highlight') {
        const [a,b] = o.points;
        p.drawLine({start:{x:a.x,y:height-a.y},end:{x:b.x,y:height-b.y},thickness:o.width,color:color(o.color),opacity:o.type==='highlight'?0.3:1,lineCap:LineCapStyle.Round});
      } else if (o.type === 'pen') {
        const pts = o.points;
        // One connected path avoids dark joints and keeps the PDF layer vector-based.
        const path = pts.map((pt,i) => `${i?'L':'M'} ${pt.x} ${pt.y}`).join(' ');
        p.drawSvgPath(path,{x:0,y:height,borderColor:color(o.color),borderWidth:o.width,borderLineCap:LineCapStyle.Round});
      }
    }
    layers.push({index,page:p});
  }
  // Materialize pending embedded font/image resources before cross-document copying.
  await layer.flush();
  const embeddedPages = await output.embedPages(layers.map(item => item.page));
  for (const [layerIndex, {index}] of layers.entries()) {
    const embedded = embeddedPages[layerIndex];
    const target = output.getPage(index);
    const box = target.getCropBox();
    const angle = ((target.getRotation().angle % 360)+360)%360;
    const swap = angle===90 || angle===270;
    const offset = angle===90 ? [box.width,0] : angle===180 ? [box.width,box.height] : angle===270 ? [0,box.height] : [0,0];
    target.drawPage(embedded, {x:box.x+offset[0],y:box.y+offset[1],width:swap?box.height:box.width,height:swap?box.width:box.height,rotate:degrees(angle)});
  }
  // Regenerate only changed text fields with the Japanese font above. Preserve
  // the original appearances of untouched text fields and other widget types.
  return output.save({updateFieldAppearances:false});
}
