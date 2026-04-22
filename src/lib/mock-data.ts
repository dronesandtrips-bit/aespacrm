// Mock store em memória — substituir por Supabase quando conectarmos.
export type Category = { id: string; name: string; color: string };
export type Contact = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  categoryId?: string;
  createdAt: string;
};
export type BulkSend = {
  id: string;
  name: string;
  message: string;
  intervalSeconds: number;
  totalContacts: number;
  sentCount: number;
  status: "pending" | "in_progress" | "completed" | "error";
  createdAt: string;
};
export type PipelineStage = { id: string; name: string; color: string; order: number };
export type PipelinePlacement = { contactId: string; stageId: string };
export type ChatMessage = {
  id: string;
  contactId: string;
  body: string;
  fromMe: boolean;
  at: string;
};

const STORAGE_KEY = "wpp-crm-data-v2";

type Store = {
  contacts: Contact[];
  categories: Category[];
  bulkSends: BulkSend[];
  stages: PipelineStage[];
  pipeline: PipelinePlacement[];
  messages: ChatMessage[];
};

function isoMinusDays(d: number) {
  return new Date(Date.now() - d * 86400000).toISOString();
}
function isoMinusMin(m: number) {
  return new Date(Date.now() - m * 60000).toISOString();
}

const seed: Store = {
  categories: [
    { id: "c1", name: "Lead", color: "#3B82F6" },
    { id: "c2", name: "Cliente", color: "#10B981" },
    { id: "c3", name: "VIP", color: "#F59E0B" },
    { id: "c4", name: "Inativo", color: "#64748B" },
  ],
  contacts: [
    { id: "1", name: "Ana Souza", phone: "+55 11 91234-5678", email: "ana@exemplo.com", categoryId: "c2", createdAt: isoMinusDays(30) },
    { id: "2", name: "Bruno Lima", phone: "+55 21 98888-1111", categoryId: "c1", createdAt: isoMinusDays(10) },
    { id: "3", name: "Carla Mendes", phone: "+55 31 97777-2222", email: "carla@vip.com", categoryId: "c3", createdAt: isoMinusDays(60) },
    { id: "4", name: "Diego Alves", phone: "+55 41 96666-3333", categoryId: "c1", createdAt: isoMinusDays(5) },
    { id: "5", name: "Elaine Costa", phone: "+55 51 95555-4444", email: "elaine@empresa.com", categoryId: "c2", createdAt: isoMinusDays(20) },
    { id: "6", name: "Fábio Rocha", phone: "+55 61 94444-5555", categoryId: "c4", createdAt: isoMinusDays(120) },
  ],
  bulkSends: [
    { id: "b1", name: "Promoção de Outono", message: "Olá {nome}! Aproveite 20% off...", intervalSeconds: 3, totalContacts: 120, sentCount: 120, status: "completed", createdAt: isoMinusDays(2) },
    { id: "b2", name: "Lembrete pagamento", message: "Olá {nome}, seu boleto vence amanhã.", intervalSeconds: 5, totalContacts: 45, sentCount: 23, status: "in_progress", createdAt: isoMinusMin(30) },
    { id: "b3", name: "Pesquisa NPS", message: "{nome}, como avalia nosso serviço?", intervalSeconds: 2, totalContacts: 80, sentCount: 12, status: "error", createdAt: isoMinusDays(1) },
  ],
  stages: [
    { id: "s1", name: "Novo Lead", color: "#3B82F6", order: 0 },
    { id: "s2", name: "Em Contato", color: "#8B5CF6", order: 1 },
    { id: "s3", name: "Proposta", color: "#F59E0B", order: 2 },
    { id: "s4", name: "Negociação", color: "#EC4899", order: 3 },
    { id: "s5", name: "Fechado", color: "#10B981", order: 4 },
  ],
  pipeline: [
    { contactId: "2", stageId: "s1" },
    { contactId: "4", stageId: "s1" },
    { contactId: "5", stageId: "s2" },
    { contactId: "1", stageId: "s3" },
    { contactId: "3", stageId: "s4" },
    { contactId: "6", stageId: "s5" },
  ],
  messages: [
    { id: "m1", contactId: "1", body: "Oi! Tudo bem?", fromMe: false, at: isoMinusMin(120) },
    { id: "m2", contactId: "1", body: "Olá Ana! Tudo ótimo, e você?", fromMe: true, at: isoMinusMin(118) },
    { id: "m3", contactId: "1", body: "Quero saber sobre o plano premium", fromMe: false, at: isoMinusMin(60) },
    { id: "m4", contactId: "1", body: "Claro! Vou te mandar a proposta agora.", fromMe: true, at: isoMinusMin(55) },
    { id: "m5", contactId: "2", body: "Recebi o link, obrigado!", fromMe: false, at: isoMinusMin(45) },
    { id: "m6", contactId: "3", body: "Bom dia, podemos conversar hoje?", fromMe: false, at: isoMinusMin(15) },
    { id: "m7", contactId: "5", body: "Confirmado para amanhã às 14h", fromMe: true, at: isoMinusMin(200) },
  ],
};

function load(): Store {
  if (typeof window === "undefined") return seed;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw);
    return { ...seed, ...parsed };
  } catch {
    return seed;
  }
}
function save(s: Store) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

let store: Store | null = null;
function getStore(): Store {
  if (!store) store = load();
  return store;
}

export const db = {
  // Contacts
  listContacts(): Contact[] { return getStore().contacts; },
  listCategories(): Category[] { return getStore().categories; },
  createContact(data: Omit<Contact, "id" | "createdAt">): Contact {
    const s = getStore();
    const c: Contact = { ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    s.contacts = [c, ...s.contacts];
    save(s);
    return c;
  },
  updateContact(id: string, patch: Partial<Contact>) {
    const s = getStore();
    s.contacts = s.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c));
    save(s);
  },
  deleteContact(id: string) {
    const s = getStore();
    s.contacts = s.contacts.filter((c) => c.id !== id);
    save(s);
  },
  createCategory(name: string, color: string): Category {
    const s = getStore();
    const cat: Category = { id: crypto.randomUUID(), name, color };
    s.categories = [...s.categories, cat];
    save(s);
    return cat;
  },
  updateCategory(id: string, patch: Partial<Category>) {
    const s = getStore();
    s.categories = s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c));
    save(s);
  },
  deleteCategory(id: string) {
    const s = getStore();
    s.categories = s.categories.filter((c) => c.id !== id);
    save(s);
  },

  // Bulk
  listBulkSends(): BulkSend[] {
    return [...getStore().bulkSends].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  createBulkSend(data: Omit<BulkSend, "id" | "createdAt" | "sentCount" | "status">): BulkSend {
    const s = getStore();
    const b: BulkSend = {
      ...data,
      id: crypto.randomUUID(),
      sentCount: 0,
      status: "in_progress",
      createdAt: new Date().toISOString(),
    };
    s.bulkSends = [b, ...s.bulkSends];
    save(s);
    return b;
  },
  updateBulkSend(id: string, patch: Partial<BulkSend>) {
    const s = getStore();
    s.bulkSends = s.bulkSends.map((b) => (b.id === id ? { ...b, ...patch } : b));
    save(s);
  },

  // Pipeline
  listStages(): PipelineStage[] {
    return [...getStore().stages].sort((a, b) => a.order - b.order);
  },
  listPipeline(): PipelinePlacement[] { return getStore().pipeline; },
  moveContactToStage(contactId: string, stageId: string) {
    const s = getStore();
    const exists = s.pipeline.find((p) => p.contactId === contactId);
    if (exists) exists.stageId = stageId;
    else s.pipeline.push({ contactId, stageId });
    save(s);
  },
  createStage(name: string, color: string): PipelineStage {
    const s = getStore();
    const order = s.stages.length;
    const stage: PipelineStage = { id: crypto.randomUUID(), name, color, order };
    s.stages = [...s.stages, stage];
    save(s);
    return stage;
  },
  updateStage(id: string, patch: Partial<PipelineStage>) {
    const s = getStore();
    s.stages = s.stages.map((st) => (st.id === id ? { ...st, ...patch } : st));
    save(s);
  },
  deleteStage(id: string): { ok: boolean; reason?: string } {
    const s = getStore();
    const inUse = s.pipeline.filter((p) => p.stageId === id).length;
    if (inUse > 0) return { ok: false, reason: `Há ${inUse} contato(s) nesta etapa` };
    s.stages = s.stages.filter((st) => st.id !== id);
    save(s);
    return { ok: true };
  },
  reorderStages(orderedIds: string[]) {
    const s = getStore();
    const map = new Map(orderedIds.map((id, i) => [id, i]));
    s.stages = s.stages.map((st) => ({ ...st, order: map.get(st.id) ?? st.order }));
    save(s);
  },

  // CSV bulk
  bulkImportContacts(rows: Array<Omit<Contact, "id" | "createdAt">>): {
    imported: number;
    skipped: number;
  } {
    const s = getStore();
    const existingPhones = new Set(s.contacts.map((c) => c.phone.replace(/\D/g, "")));
    let imported = 0;
    let skipped = 0;
    const toAdd: Contact[] = [];
    for (const row of rows) {
      const normalized = row.phone.replace(/\D/g, "");
      if (!normalized || existingPhones.has(normalized)) {
        skipped++;
        continue;
      }
      existingPhones.add(normalized);
      toAdd.push({
        ...row,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      });
      imported++;
    }
    s.contacts = [...toAdd, ...s.contacts];
    save(s);
    return { imported, skipped };
  },

  // Messages
  listMessages(contactId: string): ChatMessage[] {
    return getStore()
      .messages.filter((m) => m.contactId === contactId)
      .sort((a, b) => a.at.localeCompare(b.at));
  },
  lastMessage(contactId: string): ChatMessage | undefined {
    const list = this.listMessages(contactId);
    return list[list.length - 1];
  },
  sendMessage(contactId: string, body: string): ChatMessage {
    const s = getStore();
    const m: ChatMessage = {
      id: crypto.randomUUID(),
      contactId,
      body,
      fromMe: true,
      at: new Date().toISOString(),
    };
    s.messages.push(m);
    save(s);
    return m;
  },
};
