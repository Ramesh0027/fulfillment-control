import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
export type Status = 'open' | 'investigating' | 'resolved';
export interface Case { id: string; orderId: string; title: string; facility: string; severity: 'high' | 'medium' | 'low'; status: Status; owner: string; dueAt: string; createdAt: string; version: number }
export class DomainError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export class Store {
  db: DatabaseSync;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, title TEXT NOT NULL, facility TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL, owner TEXT NOT NULL, dueAt TEXT NOT NULL, createdAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, caseId TEXT NOT NULL REFERENCES cases(id), message TEXT NOT NULL, createdAt TEXT NOT NULL);`);
  }
  list(q = '', status = '', severity = ''): Case[] {
    return this.db.prepare(`SELECT * FROM cases WHERE (instr(lower(title || ' ' || orderId || ' ' || facility), lower(?)) > 0) AND (? = '' OR status = ?) AND (? = '' OR severity = ?) ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, dueAt`).all(q, status, status, severity, severity) as unknown as Case[];
  }
  get(id: string): Case {
    const row = this.db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as unknown as Case;
    if (!row) throw new DomainError(404, 'Case not found');
    return row;
  }
  history(id: string) { this.get(id); return this.db.prepare('SELECT id, message, createdAt FROM events WHERE caseId = ? ORDER BY id DESC').all(id); }
  create(input: Omit<Case, 'id' | 'status' | 'version' | 'createdAt'>): Case {
    const id = randomUUID(), now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, input.orderId, input.title, input.facility, input.severity, 'open', input.owner, input.dueAt, now, 1);
      this.db.prepare('INSERT INTO events(caseId, message, createdAt) VALUES (?, ?, ?)').run(id, 'Case opened', now);
      this.db.exec('COMMIT'); return this.get(id);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  change(id: string, version: number, input: { status?: Status; owner?: string; note?: string }): Case {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const item = this.get(id);
      if (item.version !== version) throw new DomainError(409, 'This case changed. Refresh before saving.');
      const next = input.status ?? item.status;
      const allowed: Record<Status, Status[]> = { open: ['open', 'investigating'], investigating: ['investigating', 'resolved'], resolved: ['resolved', 'investigating'] };
      if (!allowed[item.status].includes(next)) throw new DomainError(409, 'Start an investigation before resolving this case.');
      if (next === 'resolved' && item.status !== 'resolved' && !input.note?.trim()) throw new DomainError(422, 'Add a resolution note.');
      const notes = [next !== item.status ? `Status: ${item.status} → ${next}` : '', input.owner !== undefined && input.owner !== item.owner ? `Assigned to ${input.owner || 'Unassigned'}` : '', input.note?.trim() ?? ''].filter(Boolean);
      if (!notes.length) throw new DomainError(422, 'No changes to save');
      this.db.prepare('UPDATE cases SET status = ?, owner = ?, version = version + 1 WHERE id = ?').run(next, input.owner ?? item.owner, id);
      this.db.prepare('INSERT INTO events(caseId, message, createdAt) VALUES (?, ?, ?)').run(id, notes.join(' · '), new Date().toISOString());
      this.db.exec('COMMIT'); return this.get(id);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  seed() {
    if (this.list().length) return;
    const samples = [
      ['Carrier scan missing','ORD-2048','Seattle · FC-01','high',-2,'Alex'],
      ['Inventory count mismatch','ORD-2053','Austin · FC-03','high',1,'Jordan'],
      ['Delivery slot unavailable','ORD-2039','Seattle · FC-01','medium',3,''],
      ['Address needs verification','ORD-2061','Denver · FC-02','medium',6,'Sam'],
      ['Label generation failed','ORD-2070','Austin · FC-03','low',12,''],
      ['Pick confirmation delayed','ORD-2044','Denver · FC-02','high',-1,'Alex'],
      ['Package weight variance','ORD-2072','Seattle · FC-01','low',24,'Jordan'],
      ['Customer reschedule request','ORD-2066','Denver · FC-02','medium',8,'Sam'],
    ];
    for (const [title, orderId, facility, severity, hours, owner] of samples) this.create({ title: String(title), orderId: String(orderId), facility: String(facility), severity: severity as Case['severity'], dueAt: new Date(Date.now() + Number(hours)*3600000).toISOString(), owner: String(owner) });
    const items = this.list(); this.change(items[1].id, 1, {status:'investigating',note:'Carrier trace started.'});
  }
  close() { this.db.close(); }
}
