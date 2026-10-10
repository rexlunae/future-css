import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { JsAccelerator, CORE_ABI_VERSION } from '../src/js/accelerator.ts';
const path = (crate:string, suffix:string) => new URL(`../dist/wasm/${crate}/web/${crate.replaceAll('-','_')}${suffix}`,import.meta.url);
const built = ['fc-model','fc-grid','fc-rich-text'].every(crate=>existsSync(path(crate,'.js')));
async function load(crate:string):Promise<any> {
  const mod=await import(path(crate,'.js').href);
  await mod.default({module_or_path:await readFile(path(crate,'_bg.wasm'))});
  assert.equal(mod.abiVersion(),CORE_ABI_VERSION);
  return mod;
}
const clamp = (text:string, offset:number) => new JsAccelerator().slice(text,0,offset).length;

describe('primitive WASM boundaries', {skip: built ? false : 'run build:wasm first'}, () => {
  it('returns exact replacement coordinates for every Unicode offset pair', async () => {
    const mod=await load('fc-model');
    for (const text of ['aé😀b','日本語\n🌍','a\u0301\n']) {
      for(let start=0;start<=text.length;start++) for(let end=start;end<=text.length;end++) {
        const buffer=new mod.TextBuffer(text);
        try {
          const from=clamp(text,start),to=clamp(text,end);
          const range=buffer.replace16(start,end,'🌎x');
          assert.ok(range instanceof Uint32Array);
          assert.deepEqual([...range],[from,from+3]);
          assert.equal(buffer.text,text.slice(0,from)+'🌎x'+text.slice(to));
        } finally {buffer.free();}
      }
    }
  });
  it('encodes line coordinates and classified errors without JS objects', async () => {
    const mod=await load('fc-model'),buffer=new mod.TextBuffer('😀\nx\n');
    try {
      assert.deepEqual([...buffer.lines16()],[0,2,3,4,5,5]);
      assert.deepEqual([...buffer.lineAt(3)],[3,4]);
      let caught:any;try {buffer.lineAt(99);}catch(error){caught=error;}
      assert.equal(typeof caught,'string');assert.match(caught,/^fc:outOfBounds:/);
    } finally {buffer.free();}
  });
  it('flattens grid ranges, row-major cells and overscan without losing coordinates', async () => {
    const mod=await load('fc-grid');
    for(let row=0;row<4;row++) for(let col=0;col<4;col++) {
      const range=mod.CellRange.fromCorners(row+1,col+1,row,col);
      const viewport=mod.Viewport.new(row,col,2,2,1);
      try {
        assert.ok(range.toArray() instanceof Uint32Array);
        assert.deepEqual([...range.toArray()],[row,col,row+1,col+1]);
        assert.deepEqual([...range.cells()],[row,col,row,col+1,row+1,col,row+1,col+1]);
        assert.deepEqual([...viewport.visibleRange()],[row,col,row+1,col+1]);
        assert.deepEqual([...viewport.renderRange()],[Math.max(0,row-1),Math.max(0,col-1),row+2,col+2]);
      } finally {range.free();viewport.free();}
    }
  });
  it('round-trips every JSON control character, quotes and multilingual text', async () => {
    const mod=await load('fc-rich-text');
    const text=Array.from({length:32},(_,i)=>String.fromCharCode(i)).join('')+'"\\日本語 😀 العربية e\u0301\u2028\u2029';
    const block=new mod.Block(text);
    try {
      block.applyMark('bold',0,text.length);
      assert.deepEqual(JSON.parse(block.serialize()),{text,spans:[{mark:'bold',start:0,end:text.length}]});
      const split=JSON.parse(block.splitAt(32));
      assert.equal(split[0].text+split[1].text,text);
      assert.deepEqual(split[1].spans,[{mark:'bold',start:0,end:text.length-32}]);
    } finally {block.free();}
  });
  it('splits and rebases marks at every UTF-16 position using the JS boundary rule', async () => {
    const mod=await load('fc-rich-text'),text='a😀日本語🌍b';
    for(let offset=0;offset<=text.length;offset++) {
      const block=new mod.Block(text);
      try {
        block.applyMark('bold',0,text.length);
        const [left,right]=JSON.parse(block.splitAt(offset)),boundary=clamp(text,offset);
        assert.equal(left.text,text.slice(0,boundary));assert.equal(right.text,text.slice(boundary));
        assert.deepEqual(left.spans,boundary ? [{mark:'bold',start:0,end:boundary}] : []);
        assert.deepEqual(right.spans,boundary<text.length ? [{mark:'bold',start:0,end:text.length-boundary}] : []);
      } finally {block.free();}
    }
  });
});
