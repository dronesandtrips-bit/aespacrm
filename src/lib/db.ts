// Cliente de dados que fala com Supabase (schema aespacrm).
// Substitui mock-data.ts. Todas as funções são async e RLS-safe:
// o usuário só consegue ver/modificar as próprias linhas.

import { getSupabaseClient } from "@/integrations/supabase/client";

// ===================== Tipos =====================

export type Category = { id: string; name: string; color: string; sequenceId?: string | null };
export type Contact = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  categoryId?: string | null;
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
export type PipelineStage = { id: string; name: string; color: string; order: number; sequenceId?: string | null };
export type PipelinePlacement = { contactId: string; stageId: string };
export type ChatMessage = {
  id: string;
  contactId: string;
  body: string;
  fromMe: boolean;
  at: string;
};

export type Sequence = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  triggerType: "manual" | "category" | "pipeline_stage";
  triggerValue: string | null;
  windowStartHour: number;
  windowEndHour: number;
  windowDays: number[];
  createdAt: string;
};

export type SequenceStep = {
  id: string;
  sequenceId: string;
  order: number;
  message: string;
  delayValue: number;
  delayUnit: "hours" | "days";
};

export type ContactSequence = {
  id: string;
  contactId: string;
  sequenceId: string;
  currentStep: number;
  status: "active" | "paused" | "completed" | "cancelled";
  nextSendAt: string | null;
  startedAt: string;
  pausedAt: string | null;
  pauseReason: string | null;
};

// ===================== Helpers =====================

async function client() {
  const c = await getSupabaseClient();
  if (!c) throw new Error("Supabase não configurado");
  return c;
}

async function uid(): Promise<string> {
  const c = await client();
  const { data } = await c.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Usuário não autenticado");
  return id;
}

// ===================== Categorias =====================

export const categoriesDb = {
  async list(): Promise<Category[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_categories")
      .select("id,name,color")
      .order("name", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
  async create(name: string, color: string): Promise<Category> {
    const c = await client();
    const user_id = await uid();
    const { data, error } = await c
      .from("crm_categories")
      .insert({ name, color, user_id })
      .select("id,name,color")
      .single();
    if (error) throw error;
    return data;
  },
  async update(id: string, patch: Partial<Pick<Category, "name" | "color">>) {
    const c = await client();
    const { error } = await c.from("crm_categories").update(patch).eq("id", id);
    if (error) throw error;
  },
  async remove(id: string) {
    const c = await client();
    const { error } = await c.from("crm_categories").delete().eq("id", id);
    if (error) throw error;
  },
};

// ===================== Contatos =====================

function rowToContact(r: any): Contact {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    notes: r.notes,
    categoryId: r.category_id,
    createdAt: r.created_at,
  };
}

export const contactsDb = {
  async list(): Promise<Contact[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_contacts")
      .select("id,name,phone,email,notes,category_id,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToContact);
  },
  async create(input: Omit<Contact, "id" | "createdAt">): Promise<Contact> {
    const c = await client();
    const user_id = await uid();
    const { data, error } = await c
      .from("crm_contacts")
      .insert({
        user_id,
        name: input.name,
        phone: input.phone,
        email: input.email || null,
        notes: input.notes || null,
        category_id: input.categoryId || null,
      })
      .select("id,name,phone,email,notes,category_id,created_at")
      .single();
    if (error) throw error;
    return rowToContact(data);
  },
  async update(id: string, patch: Partial<Omit<Contact, "id" | "createdAt">>) {
    const c = await client();
    const dbPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.phone !== undefined) dbPatch.phone = patch.phone;
    if (patch.email !== undefined) dbPatch.email = patch.email || null;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes || null;
    if (patch.categoryId !== undefined) dbPatch.category_id = patch.categoryId || null;
    const { error } = await c.from("crm_contacts").update(dbPatch).eq("id", id);
    if (error) throw error;
  },
  async remove(id: string) {
    const c = await client();
    const { error } = await c.from("crm_contacts").delete().eq("id", id);
    if (error) throw error;
  },
  async bulkImport(
    rows: Array<Omit<Contact, "id" | "createdAt">>,
  ): Promise<{ imported: number; skipped: number }> {
    if (rows.length === 0) return { imported: 0, skipped: 0 };
    const c = await client();
    const user_id = await uid();

    // Telefones já existentes (para reportar skipped)
    const { data: existing } = await c
      .from("crm_contacts")
      .select("phone");
    const existingNorm = new Set(
      (existing ?? []).map((e: any) => String(e.phone).replace(/\D/g, "")),
    );

    const toInsert: any[] = [];
    let skipped = 0;
    const seenInBatch = new Set<string>();
    for (const r of rows) {
      const norm = r.phone.replace(/\D/g, "");
      if (!norm || existingNorm.has(norm) || seenInBatch.has(norm)) {
        skipped++;
        continue;
      }
      seenInBatch.add(norm);
      toInsert.push({
        user_id,
        name: r.name,
        phone: r.phone,
        email: r.email || null,
        notes: r.notes || null,
        category_id: r.categoryId || null,
      });
    }
    if (toInsert.length === 0) return { imported: 0, skipped };
    const { error } = await c.from("crm_contacts").insert(toInsert);
    if (error) throw error;
    return { imported: toInsert.length, skipped };
  },
};

// ===================== Pipeline =====================

export const pipelineDb = {
  async listStages(): Promise<PipelineStage[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_pipeline_stages")
      .select('id,name,color,"order"')
      .order("order", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
  async listPlacements(): Promise<PipelinePlacement[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_pipeline_placements")
      .select("contact_id,stage_id");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ contactId: r.contact_id, stageId: r.stage_id }));
  },
  async createStage(name: string, color: string): Promise<PipelineStage> {
    const c = await client();
    const user_id = await uid();
    // Calcula próximo order
    const { data: existing } = await c
      .from("crm_pipeline_stages")
      .select('"order"')
      .order("order", { ascending: false })
      .limit(1);
    const nextOrder = (existing && existing[0]?.order != null ? existing[0].order + 1 : 0);
    const { data, error } = await c
      .from("crm_pipeline_stages")
      .insert({ user_id, name, color, order: nextOrder })
      .select('id,name,color,"order"')
      .single();
    if (error) throw error;
    return data;
  },
  async updateStage(id: string, patch: Partial<Pick<PipelineStage, "name" | "color">>) {
    const c = await client();
    const { error } = await c.from("crm_pipeline_stages").update(patch).eq("id", id);
    if (error) throw error;
  },
  async deleteStage(id: string): Promise<{ ok: boolean; reason?: string }> {
    const c = await client();
    const { count } = await c
      .from("crm_pipeline_placements")
      .select("contact_id", { count: "exact", head: true })
      .eq("stage_id", id);
    if ((count ?? 0) > 0) {
      return { ok: false, reason: `Há ${count} contato(s) nesta etapa` };
    }
    const { error } = await c.from("crm_pipeline_stages").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  },
  async reorderStages(orderedIds: string[]) {
    const c = await client();
    // upsert um por um (poucos registros, ok)
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await c
        .from("crm_pipeline_stages")
        .update({ order: i })
        .eq("id", orderedIds[i]);
      if (error) throw error;
    }
  },
  async moveContactToStage(contactId: string, stageId: string) {
    const c = await client();
    const user_id = await uid();
    const { error } = await c
      .from("crm_pipeline_placements")
      .upsert(
        { contact_id: contactId, stage_id: stageId, user_id, moved_at: new Date().toISOString() },
        { onConflict: "contact_id" },
      );
    if (error) throw error;
  },
};

// ===================== Mensagens (Inbox) =====================

export const messagesDb = {
  async list(contactId: string): Promise<ChatMessage[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_messages")
      .select("id,contact_id,body,from_me,at")
      .eq("contact_id", contactId)
      .order("at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      contactId: r.contact_id,
      body: r.body,
      fromMe: r.from_me,
      at: r.at,
    }));
  },
  async send(contactId: string, body: string): Promise<ChatMessage> {
    const c = await client();
    const user_id = await uid();
    const { data, error } = await c
      .from("crm_messages")
      .insert({ user_id, contact_id: contactId, body, from_me: true })
      .select("id,contact_id,body,from_me,at")
      .single();
    if (error) throw error;
    return {
      id: data.id,
      contactId: data.contact_id,
      body: data.body,
      fromMe: data.from_me,
      at: data.at,
    };
  },
};

// ===================== Disparos =====================

function rowToBulk(r: any): BulkSend {
  return {
    id: r.id,
    name: r.name,
    message: r.message,
    intervalSeconds: r.interval_seconds,
    totalContacts: r.total_contacts,
    sentCount: r.sent_count,
    status: r.status,
    createdAt: r.created_at,
  };
}

export const bulkSendsDb = {
  async list(): Promise<BulkSend[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_bulk_sends")
      .select("id,name,message,interval_seconds,total_contacts,sent_count,status,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []).map(rowToBulk);
  },
  async create(input: {
    name: string;
    message: string;
    intervalSeconds: number;
    totalContacts: number;
  }): Promise<BulkSend> {
    const c = await client();
    const user_id = await uid();
    const { data, error } = await c
      .from("crm_bulk_sends")
      .insert({
        user_id,
        name: input.name,
        message: input.message,
        interval_seconds: input.intervalSeconds,
        total_contacts: input.totalContacts,
        status: "in_progress",
        sent_count: 0,
      })
      .select("id,name,message,interval_seconds,total_contacts,sent_count,status,created_at")
      .single();
    if (error) throw error;
    return rowToBulk(data);
  },
  async update(id: string, patch: Partial<Pick<BulkSend, "sentCount" | "status">>) {
    const c = await client();
    const dbPatch: Record<string, unknown> = {};
    if (patch.sentCount !== undefined) dbPatch.sent_count = patch.sentCount;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    const { error } = await c.from("crm_bulk_sends").update(dbPatch).eq("id", id);
    if (error) throw error;
  },
};

// ===================== Sequências =====================

function rowToSeq(r: any): Sequence {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isActive: r.is_active,
    triggerType: r.trigger_type,
    triggerValue: r.trigger_value,
    windowStartHour: r.window_start_hour,
    windowEndHour: r.window_end_hour,
    windowDays: r.window_days ?? [1, 2, 3, 4, 5],
    createdAt: r.created_at,
  };
}

function rowToStep(r: any): SequenceStep {
  return {
    id: r.id,
    sequenceId: r.sequence_id,
    order: r.order,
    message: r.message,
    delayValue: r.delay_value,
    delayUnit: r.delay_unit,
  };
}

function rowToContactSeq(r: any): ContactSequence {
  return {
    id: r.id,
    contactId: r.contact_id,
    sequenceId: r.sequence_id,
    currentStep: r.current_step,
    status: r.status,
    nextSendAt: r.next_send_at,
    startedAt: r.started_at,
    pausedAt: r.paused_at,
    pauseReason: r.pause_reason,
  };
}

export const sequencesDb = {
  async list(): Promise<Sequence[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_sequences")
      .select(
        "id,name,description,is_active,trigger_type,trigger_value,window_start_hour,window_end_hour,window_days,created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToSeq);
  },

  async create(input: {
    name: string;
    description?: string;
    triggerType?: Sequence["triggerType"];
    triggerValue?: string | null;
  }): Promise<Sequence> {
    const c = await client();
    const user_id = await uid();
    const { data, error } = await c
      .from("crm_sequences")
      .insert({
        user_id,
        name: input.name,
        description: input.description ?? null,
        trigger_type: input.triggerType ?? "manual",
        trigger_value: input.triggerValue ?? null,
        is_active: true,
      })
      .select(
        "id,name,description,is_active,trigger_type,trigger_value,window_start_hour,window_end_hour,window_days,created_at",
      )
      .single();
    if (error) throw error;
    return rowToSeq(data);
  },

  async update(
    id: string,
    patch: Partial<{
      name: string;
      description: string | null;
      isActive: boolean;
      triggerType: Sequence["triggerType"];
      triggerValue: string | null;
      windowStartHour: number;
      windowEndHour: number;
      windowDays: number[];
    }>,
  ) {
    const c = await client();
    const dbPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.isActive !== undefined) dbPatch.is_active = patch.isActive;
    if (patch.triggerType !== undefined) dbPatch.trigger_type = patch.triggerType;
    if (patch.triggerValue !== undefined) dbPatch.trigger_value = patch.triggerValue;
    if (patch.windowStartHour !== undefined) dbPatch.window_start_hour = patch.windowStartHour;
    if (patch.windowEndHour !== undefined) dbPatch.window_end_hour = patch.windowEndHour;
    if (patch.windowDays !== undefined) dbPatch.window_days = patch.windowDays;
    const { error } = await c.from("crm_sequences").update(dbPatch).eq("id", id);
    if (error) throw error;
  },

  async remove(id: string) {
    const c = await client();
    const { error } = await c.from("crm_sequences").delete().eq("id", id);
    if (error) throw error;
  },

  async listSteps(sequenceId: string): Promise<SequenceStep[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_sequence_steps")
      .select('id,sequence_id,"order",message,delay_value,delay_unit')
      .eq("sequence_id", sequenceId)
      .order("order", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(rowToStep);
  },

  async saveSteps(
    sequenceId: string,
    steps: Array<{ message: string; delayValue: number; delayUnit: "hours" | "days" }>,
  ) {
    const c = await client();
    const user_id = await uid();
    // Estratégia simples: apaga e recria
    const { error: delErr } = await c
      .from("crm_sequence_steps")
      .delete()
      .eq("sequence_id", sequenceId);
    if (delErr) throw delErr;
    if (steps.length === 0) return;
    const rows = steps.map((s, i) => ({
      user_id,
      sequence_id: sequenceId,
      order: i,
      message: s.message,
      delay_value: s.delayValue,
      delay_unit: s.delayUnit,
    }));
    const { error } = await c.from("crm_sequence_steps").insert(rows);
    if (error) throw error;
  },

  async listContactSequences(): Promise<ContactSequence[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_contact_sequences")
      .select(
        "id,contact_id,sequence_id,current_step,status,next_send_at,started_at,paused_at,pause_reason",
      )
      .order("started_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToContactSeq);
  },

  async enroll(sequenceId: string, contactIds: string[]): Promise<{ enrolled: number }> {
    if (contactIds.length === 0) return { enrolled: 0 };
    const c = await client();
    const user_id = await uid();
    // Pega primeiro step pra calcular next_send_at
    const { data: steps } = await c
      .from("crm_sequence_steps")
      .select('"order",delay_value,delay_unit')
      .eq("sequence_id", sequenceId)
      .order("order", { ascending: true })
      .limit(1);
    const first = steps?.[0];
    const ms = first
      ? first.delay_value *
        (first.delay_unit === "hours" ? 3600_000 : 86_400_000)
      : 0;
    const nextAt = new Date(Date.now() + ms).toISOString();

    const rows = contactIds.map((cid) => ({
      user_id,
      contact_id: cid,
      sequence_id: sequenceId,
      current_step: 0,
      status: "active" as const,
      next_send_at: nextAt,
    }));
    const { error, count } = await c
      .from("crm_contact_sequences")
      .upsert(rows, { onConflict: "contact_id,sequence_id", ignoreDuplicates: true, count: "exact" });
    if (error) throw error;
    return { enrolled: count ?? rows.length };
  },

  async pauseContact(contactSequenceId: string, reason = "manual") {
    const c = await client();
    const { error } = await c
      .from("crm_contact_sequences")
      .update({ status: "paused", paused_at: new Date().toISOString(), pause_reason: reason })
      .eq("id", contactSequenceId);
    if (error) throw error;
  },

  async resumeContact(contactSequenceId: string) {
    const c = await client();
    const { error } = await c
      .from("crm_contact_sequences")
      .update({ status: "active", paused_at: null, pause_reason: null })
      .eq("id", contactSequenceId);
    if (error) throw error;
  },
};

