import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, DomainError } from '../server/store.ts';
import { createApp } from '../server/app.ts';
const sample = {title:'Carrier scan missing',orderId:'ORD-42',facility:'Seattle',severity:'high' as const,owner:'',dueAt:'2026-10-01T12:00:00.000Z'};
test('state transitions and resolution note preserve an audit trail',()=>{
 const s=new Store();try {const c=s.create(sample);
 assert.throws(()=>s.change(c.id,1,{status:'resolved',note:'done'}),DomainError);
 const active=s.change(c.id,1,{status:'investigating',owner:'Alex'});
 assert.throws(()=>s.change(c.id,active.version,{status:'resolved'}),/resolution note/);
 const closed=s.change(c.id,2,{status:'resolved',note:'Carrier confirmed pickup'});
 assert.equal(closed.status,'resolved');assert.equal(s.history(c.id).length,3);
 assert.equal(s.change(c.id,3,{status:'investigating',note:'Reopened'}).version,4);
 }finally{s.close();}
});
test('stale writes roll back without overwriting newer data',()=>{
 const s=new Store();try{const c=s.create(sample);s.change(c.id,1,{owner:'Alex'});
 assert.throws(()=>s.change(c.id,1,{owner:'Sam'}),(e)=>e instanceof DomainError&&e.status===409);
 assert.equal(s.get(c.id).owner,'Alex');assert.equal(s.history(c.id).length,2);
 }finally{s.close();}
});
test('search input is literal and filters compose',()=>{
 const s=new Store();try{s.create(sample);s.create({...sample,title:'Address validation',severity:'low'});
 assert.equal(s.list('CARRIER','','high').length,1);assert.equal(s.list("' OR 1=1 --").length,0);
 assert.equal(s.list('','resolved').length,0);}finally{s.close();}
});
test('HTTP validation, conflicts, missing resources and create flow',async()=>{
 const s=new Store(),server=createApp(s).listen(0,'127.0.0.1');
 await new Promise<void>(r=>server.once('listening',r));const a=server.address();assert(a&&typeof a==='object');
 const base=`http://127.0.0.1:${a.port}/api`;
 try{
 const request=(path:string,method:string,body:unknown)=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await request('/cases','POST',{...sample,severity:'critical'})).status,422);
 const created=await request('/cases','POST',sample);assert.equal(created.status,201);const c=await created.json();
 assert.equal((await request('/cases/'+c.id,'PATCH',{version:1,owner:'Alex'})).status,200);
 assert.equal((await request('/cases/'+c.id,'PATCH',{version:1,owner:'Sam'})).status,409);
 assert.equal((await fetch(base+'/cases/missing/events')).status,404);
 assert.equal((await fetch(base+'/cases?status=wrong')).status,422);
 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));s.close();}
});
