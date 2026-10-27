// Copy pages while retaining the AcroForm tree; copyPages alone loses that tree.
export async function assemblePdf({sources,pages,formValues={},fontBytes}) {
  const {PDFDocument,PDFName:N,PDFDict,PDFArray,PDFString,PDFHexString,PDFObjectCopier}=globalThis.PDFLib;
  const output=await PDFDocument.load(sources[0].bytes.slice());
  const basePages=output.getPages();
  const identity=pages.length===basePages.length&&pages.every((p,i)=>p.source===0&&p.page===i);
  const used=new Set(pages.map(p=>p.source));
  const copies=new Map(),rootsSeen=new Set();
  for(const sourceIndex of new Set([0,...used])) {
    const doc=sourceIndex===0?output:await PDFDocument.load(sources[sourceIndex].bytes.slice());
    const form=doc.getForm();
    const values=Object.entries(formValues).filter(([key])=>key.startsWith(`${sourceIndex}:`));
    if(values.length) {
      doc.registerFontkit(globalThis.fontkit);
      const font=await doc.embedFont(fontBytes,{subset:false});
      for(const [key,value] of values) {
        const field=form.getTextField(key.slice(key.indexOf(':')+1));
        if(field.isReadOnly())continue;
        field.setText(value);field.updateAppearances(font);
      }
    }
    if(sourceIndex===0) {
      for(const field of form.acroForm.getFields()) {
        const name=field[0].getPartialName();if(name)rootsSeen.add(name);
      }
      continue;
    }
    // Names from separate documents must not accidentally become the same field.
    let prefix=`PDFNoteSource${sourceIndex}_`;
    while([...rootsSeen].some(name=>name.startsWith(prefix)))prefix+='_';
    for(const [field] of form.acroForm.getFields()) {
      const name=prefix+(field.getPartialName()||'field');
      field.dict.set(N.of('T'),PDFHexString.fromText(name));rootsSeen.add(name);
    }
    await doc.flush();
    const copier=PDFObjectCopier.for(doc.context,output.context);
    const sourceDR=form.acroForm.dict.lookupMaybe(N.of('DR'),PDFDict);
    const donorFonts=sourceDR?.lookupMaybe(N.of('Font'),PDFDict);
    const fonts=new Map();
    if(donorFonts) {
      const targetForm=output.getForm().acroForm.dict;
      let dr=targetForm.lookupMaybe(N.of('DR'),PDFDict);
      if(!dr){dr=output.context.obj({});targetForm.set(N.of('DR'),dr);}
      let targetFonts=dr.lookupMaybe(N.of('Font'),PDFDict);
      if(!targetFonts){targetFonts=output.context.obj({});dr.set(N.of('Font'),targetFonts);}
      for(const [key,value] of donorFonts.entries()) {
        const renamed=N.of(prefix+key.decodeText());fonts.set(key.toString(),renamed.toString());
        targetFonts.set(renamed,copier.copy(value));
      }
    }
    // A donor's inherited default appearance depends on its AcroForm resources.
    const donorDA=form.acroForm.dict.lookupMaybe(N.of('DA'),PDFString,PDFHexString)?.decodeText();
    const rewrite=da=>da.replace(/\/[^\s]+(?=\s+[-+\d.]+\s+Tf\b)/g,name=>fonts.get(name)||name);
    for(const field of form.getFields()) {
      const da=field.acroField.getDefaultAppearance()||donorDA;
      if(da)field.acroField.setDefaultAppearance(rewrite(da));
      for(const widget of field.acroField.getWidgets()) {
        const widgetDA=widget.getDefaultAppearance();if(widgetDA)widget.setDefaultAppearance(rewrite(widgetDA));
      }
    }
    const positions=pages.map((p,i)=>p.source===sourceIndex?i:-1).filter(i=>i!==-1);
    const copied=await output.copyPages(doc,positions.map(i=>pages[i].page));
    positions.forEach((position,i)=>copies.set(position,copied[i]));
  }
  if(identity)return output;
  if(!identity) {
    while(output.getPageCount())output.removePage(output.getPageCount()-1);
    pages.forEach((p,i)=>output.addPage(p.source===0?basePages[p.page]:copies.get(i)));
  }
  // Retain only field nodes leading to widgets on the surviving pages. This also
  // removes widgets on deleted pages from the Kids arrays of shared fields.
  const retained=new Set(),roots=new Map();
  for(const page of output.getPages()) {
    const annots=page.node.lookupMaybe(N.of('Annots'),PDFArray);
    if(!annots)continue;
    for(let i=0;i<annots.size();i++) {
      let ref=annots.get(i),dict=output.context.lookup(ref);
      if(!(dict instanceof PDFDict)||dict.get(N.of('Subtype'))!==N.of('Widget'))continue;
      dict.set(N.of('P'),page.ref);
      const visited=new Set();
      while(dict instanceof PDFDict&&!visited.has(dict)) {
        visited.add(dict);retained.add(dict);
        const parent=dict.get(N.of('Parent'));
        if(!parent){roots.set(dict,ref);break;}
        ref=parent;dict=output.context.lookup(parent);
      }
    }
  }
  for(const dict of retained) {
    const kids=dict.lookupMaybe(N.of('Kids'),PDFArray);
    if(kids)dict.set(N.of('Kids'),output.context.obj(kids.asArray().filter(ref=>retained.has(output.context.lookup(ref)))));
  }
  const targetForm=output.getForm().acroForm.dict;
  targetForm.set(N.of('Fields'),output.context.obj([...roots.values()]));
  const order=targetForm.lookupMaybe(N.of('CO'),PDFArray);
  if(order)targetForm.set(N.of('CO'),output.context.obj(order.asArray().filter(ref=>retained.has(output.context.lookup(ref)))));
  return output;
}
