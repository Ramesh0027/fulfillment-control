import express from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { Store, DomainError } from './store.ts';
const createSchema = z.object({ title: z.string().trim().min(4).max(160), orderId: z.string().trim().min(1).max(40), facility: z.string().trim().min(1).max(80), severity: z.enum(['high','medium','low']), owner: z.string().trim().max(60).default(''), dueAt: z.iso.datetime() }).strict();
const patchSchema = z.object({ version: z.number().int().positive(), status: z.enum(['open','investigating','resolved']).optional(), owner: z.string().trim().max(60).optional(), note: z.string().trim().max(1000).optional() }).strict();
export function createApp(store: Store) {
  const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/cases', (req, res) => {
    const q = z.object({ q:z.string().max(100).default(''), status:z.enum(['','open','investigating','resolved']).default(''), severity:z.enum(['','high','medium','low']).default('') }).parse(req.query);
    res.json(store.list(q.q,q.status,q.severity));
  });
  app.post('/api/cases', (req, res) => res.status(201).json(store.create(createSchema.parse(req.body))));
  app.get('/api/cases/:id/events', (req, res) => res.json(store.history(String(req.params.id))));
  app.patch('/api/cases/:id', (req,res) => { const {version,...patch}=patchSchema.parse(req.body); res.json(store.change(String(req.params.id),version,patch)); });
  app.use('/api', (_req,res) => res.status(404).json({error:'Endpoint not found'}));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(422).json({error:'Invalid input',details:err.issues.map(i=>({field:i.path.join('.'),message:i.message}))});
    if (err instanceof DomainError) return res.status(err.status).json({error:err.message});
    if (err instanceof SyntaxError) return res.status(400).json({error:'Invalid JSON'});
    if (typeof err === 'object' && err && 'status' in err && err.status === 413) return res.status(413).json({error:'Request too large'});
    console.error(err); return res.status(500).json({error:'Unexpected server error'});
  });
  return app;
}
