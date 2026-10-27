export class PageSidebar {
  constructor({list,state,getPage,navigate,move,remove}) {
    Object.assign(this,{list,state,getPage,navigate,move,remove});
    this.cards=new Map();this.visible=new Set();this.pending=new Set();this.tasks=new Set();this.epoch=0;this.signature='';this.running=false;this.dragged=null;
    this.observer=new IntersectionObserver(entries=>{
      for(const entry of entries){const id=entry.target.dataset.pageId;if(entry.isIntersecting){this.visible.add(id);this.pending.add(id);}else this.visible.delete(id);}
      this.pump();
    },{root:list,rootMargin:'300px 0px'});
    list.addEventListener('click',event=>{const card=event.target.closest('.thumb-card');if(!card||this.state().busy)return;card.focus();this.navigate(this.index(card.dataset.pageId));});
    list.addEventListener('keydown',event=>{
      if(this.state().busy)return;
      const card=event.target.closest('.thumb-card');if(!card)return;
      const index=this.index(card.dataset.pageId);
      if(event.key==='Delete'){event.preventDefault();event.stopPropagation();this.remove(index);}
      else if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
        event.preventDefault();const count=this.state().pages.length;
        const target=event.key==='Home'?0:event.key==='End'?count-1:Math.max(0,Math.min(count-1,index+(event.key==='ArrowUp'?-1:1)));
        const next=this.cards.get(this.state().pages[target].id);next?.focus();next?.scrollIntoView({block:'nearest'});this.navigate(target);
      }
    });
    list.addEventListener('dragstart',event=>{
      const card=event.target.closest('.thumb-card');if(!card||this.state().busy){event.preventDefault();return;}
      this.dragged=card.dataset.pageId;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',this.dragged);card.classList.add('dragging');
    });
    list.addEventListener('dragover',event=>{
      if(!this.dragged||this.state().busy)return;
      event.preventDefault();event.dataTransfer.dropEffect='move';this.clearMarks();
      const card=event.target.closest('.thumb-card');
      if(card){const r=card.getBoundingClientRect();card.classList.add(event.clientY<r.top+r.height/2?'drop-before':'drop-after');}
      // Keep dragging usable beyond the currently visible thumbnails.
      const r=list.getBoundingClientRect();if(event.clientY<r.top+36)list.scrollTop-=18;else if(event.clientY>r.bottom-36)list.scrollTop+=18;
    });
    list.addEventListener('drop',event=>{
      if(!this.dragged||this.state().busy)return;
      event.preventDefault();const from=this.index(this.dragged),card=event.target.closest('.thumb-card');
      let slot=this.state().pages.length;
      if(card){const r=card.getBoundingClientRect();slot=this.index(card.dataset.pageId)+(event.clientY>=r.top+r.height/2?1:0);}
      const target=slot>from?slot-1:slot;this.dragged=null;this.clearMarks();
      if(from>=0&&target!==from)this.move(from,target);
    });
    list.addEventListener('dragend',()=>{this.dragged=null;this.clearMarks();});
  }
  index(id){return this.state().pages.findIndex(page=>page.id===id);}
  clearMarks(){for(const card of this.cards.values())card.classList.remove('drop-before','drop-after','dragging');}
  reset(){this.epoch++;for(const task of this.tasks)task.cancel();this.tasks.clear();this.signature='';this.pending.clear();}
  invalidate(){this.epoch++;for(const card of this.cards.values())card.dataset.ready='';for(const id of this.visible)this.pending.add(id);this.pump();}
  sync() {
    const state=this.state(),signature=`${state.revision}:${state.pages.map(page=>page.id).join(',')}`;
    if(signature!==this.signature) {
      const focused=this.list.contains(document.activeElement);this.reset();this.signature=signature;this.observer.disconnect();this.cards.clear();this.visible.clear();this.list.replaceChildren();
      state.pages.forEach((page,index)=>{
        const card=document.createElement('div');card.className='thumb-card';card.dataset.pageId=page.id;card.draggable=true;card.tabIndex=-1;card.setAttribute('role','option');
        const source=state.sources[page.source];card.setAttribute('aria-label',`${index+1}ページ：${source.name}、元の${page.page+1}ページ`);card.title=`${source.name}（元の${page.page+1}ページ）`;
        const number=document.createElement('span');number.className='thumb-number';number.textContent=index+1;
        const frame=document.createElement('div');frame.className='thumb-frame';const d=state.dimensions[index];frame.style.aspectRatio=d?`${d.width}/${d.height}`:'210/297';
        const canvas=document.createElement('canvas');canvas.width=0;canvas.height=0;frame.append(canvas);card.append(number,frame);this.cards.set(page.id,card);this.list.append(card);this.observer.observe(card);
      });
      if(focused)this.cards.get(state.pages[state.current]?.id)?.focus({preventScroll:true});
    }
    for(const [id,card] of this.cards){const active=id===state.pages[state.current]?.id;card.classList.toggle('selected-page',active);card.setAttribute('aria-selected',String(active));card.tabIndex=active?0:-1;card.draggable=!state.busy;}
    this.list.setAttribute('aria-busy',String(state.busy));this.pump();
  }
  async pump() {
    if(this.running||this.state().busy||this.state().tool!=='select')return;
    this.running=true;
    try {
      while(this.pending.size&&!this.state().busy&&this.state().tool==='select') {
        const id=this.pending.values().next().value;this.pending.delete(id);
        const card=this.cards.get(id);if(!card||card.dataset.ready==='true'||!this.visible.has(id))continue;
        const epoch=this.epoch,index=this.index(id);if(index<0)continue;
        try {
          const page=await this.getPage(index),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:180/base.width});
          const fields=await page.getAnnotations({intent:'display'});if(epoch!==this.epoch)continue;
          // Offscreen rendering keeps old thumbnail pixels intact during edits.
          const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width*1.5);canvas.height=Math.ceil(viewport.height*1.5);
          const ctx=canvas.getContext('2d'),task=page.render({canvasContext:ctx,viewport,transform:[1.5,0,0,1.5,0,0]});this.tasks.add(task);
          try{await task.promise;}finally{this.tasks.delete(task);}
          if(epoch!==this.epoch)continue;
          const state=this.state();ctx.save();ctx.scale(1.5*viewport.scale,1.5*viewport.scale);
          await paintNotes(ctx,state.notes[index]||[]);
          paintFields(ctx,fields,state.values,state.pages[index].source,page.getViewport({scale:1}));ctx.restore();
          if(epoch!==this.epoch)continue;
          const target=card.querySelector('canvas');target.width=canvas.width;target.height=canvas.height;target.getContext('2d').drawImage(canvas,0,0);card.querySelector('.thumb-frame').style.aspectRatio=`${base.width}/${base.height}`;card.dataset.ready='true';
        }catch(e){if(epoch===this.epoch&&e.name!=='RenderingCancelledException')card.title+=' — プレビューを表示できませんでした';}
      }
    }finally{this.running=false;if(this.pending.size&&!this.state().busy&&this.state().tool==='select')this.pump();}
  }
}
async function paintNotes(ctx,notes) {
  for(const o of notes) {
    ctx.save();
    if(o.type==='text'){ctx.fillStyle=o.color;ctx.font=`${o.size}px NoteJP`;o.text.split('\n').forEach((line,i)=>ctx.fillText(line,o.x,o.y+o.size+i*o.size*1.35));}
    else if(o.type==='image'){const image=new Image();image.src=o.data;await image.decode();ctx.drawImage(image,o.x,o.y,o.w,o.h);}
    else {ctx.strokeStyle=o.color;ctx.lineWidth=o.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=o.type==='highlight'?.3:1;ctx.beginPath();o.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}
    ctx.restore();
  }
}
function paintFields(ctx,fields,values,source,viewport) {
  const rgb=color=>`rgb(${Array.from(color).join(',')})`;
  for(const f of fields) {
    if(f.subtype!=='Widget'||f.fieldType!=='Tx'||f.readOnly||f.hidden||f.noView)continue;
    const r=viewport.convertToViewportRectangle(f.rect),x=Math.min(r[0],r[2]),y=Math.min(r[1],r[3]),rw=Math.abs(r[2]-r[0]),rh=Math.abs(r[3]-r[1]);
    const angle=((viewport.rotation-(f.rotation||0))%360+360)%360,swap=angle%180!==0,w=swap?rh:rw,h=swap?rw:rh;
    ctx.save();ctx.translate(x+rw/2,y+rh/2);ctx.rotate(angle*Math.PI/180);ctx.translate(-w/2,-h/2);ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
    if(f.backgroundColor){ctx.fillStyle=rgb(f.backgroundColor);ctx.fillRect(0,0,w,h);}
    if(f.borderColor){ctx.strokeStyle=rgb(f.borderColor);ctx.lineWidth=f.borderStyle?.width||0;if(ctx.lineWidth)ctx.strokeRect(.5,.5,w-1,h-1);}
    const size=f.defaultAppearanceData?.fontSize||Math.min(18,h*.65);ctx.font=`${size}px NoteJP`;ctx.fillStyle=rgb(f.defaultAppearanceData?.fontColor||[0,0,0]);ctx.textAlign=['left','center','right'][f.textAlignment]||'left';
    const text=values[`${source}:${f.fieldName}`]||'',lines=f.multiLine?text.split('\n'):[text];const pos=ctx.textAlign==='center'?w/2:ctx.textAlign==='right'?w-2:2;
    lines.forEach((line,i)=>ctx.fillText(f.password?'•'.repeat(line.length):line,pos,f.multiLine?size+2+i*size*1.2:(h+size*.75)/2));ctx.restore();
  }
}
