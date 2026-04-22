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

const STORAGE_KEY = "wpp-crm-data-v1";

type Store = {
  contacts: Contact[];
  categories: Category[];
};

const seed: Store = {
  categories: [
    { id: "c1", name: "Lead", color: "#3B82F6" },
    { id: "c2", name: "Cliente", color: "#10B981" },
    { id: "c3", name: "VIP", color: "#F59E0B" },
    { id: "c4", name: "Inativo", color: "#64748B" },
  ],
  contacts: [
    {
      id: "1",
      name: "Ana Souza",
      phone: "+55 11 91234-5678",
      email: "ana@exemplo.com",
      categoryId: "c2",
      createdAt: new Date().toISOString(),
    },
    {
      id: "2",
      name: "Bruno Lima",
      phone: "+55 21 98888-1111",
      categoryId: "c1",
      createdAt: new Date().toISOString(),
    },
    {
      id: "3",
      name: "Carla Mendes",
      phone: "+55 31 97777-2222",
      email: "carla@vip.com",
      categoryId: "c3",
      createdAt: new Date().toISOString(),
    },
  ],
};

function load(): Store {
  if (typeof window === "undefined") return seed;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    return JSON.parse(raw);
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
  listContacts(): Contact[] {
    return getStore().contacts;
  },
  listCategories(): Category[] {
    return getStore().categories;
  },
  createContact(data: Omit<Contact, "id" | "createdAt">): Contact {
    const s = getStore();
    const c: Contact = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    s.contacts = [c, ...s.contacts];
    save(s);
    return c;
  },
  updateContact(id: string, patch: Partial<Contact>): Contact | undefined {
    const s = getStore();
    s.contacts = s.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c));
    save(s);
    return s.contacts.find((c) => c.id === id);
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
};
