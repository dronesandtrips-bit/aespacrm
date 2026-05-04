// Cliente de dados que fala com Supabase (schema aespacrm).
// Substitui mock-data.ts. Todas as funções são async e RLS-safe:
// o usuário só consegue ver/modificar as próprias linhas.

import { getSupabaseClient } from "@/integrations/supabase/client";

// ===================== Tipos =====================

export type CategoryStatus = "approved" | "pending";
export type Category = { id: string; name: string; color: string; sequenceId?: string | null; status: CategoryStatus; keywords: string[] };
export type UrgencyLevel = "Baixa" | "Média" | "Alta";
export type Contact = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  /** Categoria principal (espelho da 1ª tag — mantido pelo trigger no DB). */
  categoryId?: string | null;
  /** Todas as tags do contato (M:N via crm_contact_categories). */
  categoryIds?: string[];
  createdAt: string;
  aiPersonaSummary?: string | null;
  urgencyLevel?: UrgencyLevel | null;
  lastAiSync?: string | null;
  /** Marcado pelo trigger quando o telefone está na blacklist do usuário. */
  isIgnored?: boolean;
  /** True se este "contato" é, na verdade, uma conversa de grupo do WhatsApp. */
  isGroup?: boolean;
  /** JID completo do WhatsApp (ex.: 120363xxx@g.us). Só preenchido para grupos. */
  waJid?: string | null;
  /** URL da foto de perfil do WhatsApp (cache da Evolution). */
  avatarUrl?: string | null;
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
export type PipelineStage = {
  id: string;
  name: string;
  color: string;
  order: number;
  sequenceId?: string | null;
};
export type PipelinePlacement = { contactId: string; stageId: string };
export type ChatMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "reaction"
  | "unknown";
export type ChatMessage = {
  id: string;
  contactId: string;
  body: string;
  fromMe: boolean;
  at: string;
  type?: ChatMessageType;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  mediaCaption?: string | null;
  status?: string | null;
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
  stopOnStageIds: string[];
  autoResumeAfterDays: number;
  createdAt: string;
};

export type MessageTemplate = {
  id: string;
  name: string;
  content: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SequenceStep = {
  id: string;
  sequenceId: string;
  order: number;
  message: string;
  delayValue: number;
  delayUnit: "hours" | "days";
  typingSeconds: number;
};

export type SequenceStepMetric = {
  order: number;
  waiting: number;
  sent: number;
  replied: number;
  responseRate: number;
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

function rowToCategory(r: any): Category {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    sequenceId: r.sequence_id ?? null,
    status: (r.status === "pending" ? "pending" : "approved") as CategoryStatus,
    keywords: Array.isArray(r.keywords) ? r.keywords.filter(Boolean) : [],
  };
}

export const categoriesDb = {
  async list(): Promise<Category[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_categories")
      .select("id,name,color,sequence_id,status,keywords")
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(rowToCategory);
  },
  async create(
    name: string,
    color: string,
    sequenceId?: string | null,
    keywords?: string[],
  ): Promise<Category> {
    const c = await client();
    const user_id = await uid();
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (!cleanName) throw new Error("Nome da categoria é obrigatório.");
    const { data: dup } = await c
      .from("crm_categories")
      .select("id,name")
      .eq("user_id", user_id)
      .ilike("name", cleanName)
      .maybeSingle();
    if (dup) {
      throw new Error(`Já existe uma categoria com o nome "${dup.name}".`);
    }
    const { data, error } = await c
      .from("crm_categories")
      .insert({
        name: cleanName,
        color,
        user_id,
        sequence_id: sequenceId ?? null,
        status: "approved",
        keywords: normalizeKeywords(keywords),
      })
      .select("id,name,color,sequence_id,status,keywords")
      .single();
    if (error) {
      if ((error as any).code === "23505") {
        throw new Error(`Já existe uma categoria com o nome "${cleanName}".`);
      }
      throw error;
    }
    return rowToCategory(data);
  },
  async update(
    id: string,
    patch: Partial<Pick<Category, "name" | "color" | "sequenceId" | "status" | "keywords">>,
  ) {
    const c = await client();
    const dbPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const cleanName = patch.name.trim().replace(/\s+/g, " ");
      if (!cleanName) throw new Error("Nome da categoria é obrigatório.");
      const user_id = await uid();
      const { data: dup } = await c
        .from("crm_categories")
        .select("id,name")
        .eq("user_id", user_id)
        .ilike("name", cleanName)
        .neq("id", id)
        .maybeSingle();
      if (dup) {
        throw new Error(`Já existe uma categoria com o nome "${dup.name}".`);
      }
      dbPatch.name = cleanName;
    }
    if (patch.color !== undefined) dbPatch.color = patch.color;
    if (patch.sequenceId !== undefined) dbPatch.sequence_id = patch.sequenceId;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.keywords !== undefined) dbPatch.keywords = normalizeKeywords(patch.keywords);
    const { error } = await c.from("crm_categories").update(dbPatch).eq("id", id);
    if (error) {
      if ((error as any).code === "23505") {
        throw new Error("Já existe uma categoria com esse nome.");
      }
      throw error;
    }
  },
  async approve(id: string) {
    return this.update(id, { status: "approved" });
  },
  async remove(id: string) {
    const c = await client();
    const { error } = await c.from("crm_categories").delete().eq("id", id);
    if (error) throw error;
  },
};

function normalizeKeywords(raw: string[] | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    const t = String(k ?? "").trim().replace(/\s+/g, " ");
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ===================== Contatos =====================

function rowToContact(r: any): Contact {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    notes: r.notes,
    categoryId: r.category_id,
    categoryIds: [],
    createdAt: r.created_at,
    aiPersonaSummary: r.ai_persona_summary ?? null,
    urgencyLevel: (r.urgency_level ?? null) as UrgencyLevel | null,
    lastAiSync: r.last_ai_sync ?? null,
    isIgnored: Boolean(r.is_ignored),
    isGroup: Boolean(r.is_group),
    waJid: r.wa_jid ?? null,
    avatarUrl: r.avatar_url ?? null,
  };
}

const CONTACT_COLUMNS =
  "id,name,phone,email,notes,category_id,created_at,ai_persona_summary,urgency_level,last_ai_sync,is_ignored,is_group,wa_jid,avatar_url";

/**
 * Se a categoria tem sequência associada, dispara o gatilho de inscrição.
 * Silencioso em caso de erro (não bloqueia a operação principal).
 */
async function maybeTriggerCategorySequence(contactId: string, categoryId: string) {
  try {
    const c = await client();
    const { data } = await c
      .from("crm_categories")
      .select("sequence_id")
      .eq("id", categoryId)
      .maybeSingle();
    const seqId = data?.sequence_id;
    if (seqId) {
      await sequencesDb.enrollFromTrigger(contactId, seqId);
    }
  } catch (err) {
    console.error("[trigger:category] falhou", err);
  }
}

/**
 * Sobrescreve as tags de um contato pela lista informada.
 * - Apaga as tags removidas
 * - Insere as novas
 * O DB mantém crm_contacts.category_id sincronizado via trigger
 * (espelho da 1ª tag por created_at).
 */
async function setContactCategories(contactId: string, categoryIds: string[]) {
  const c = await client();
  const user_id = await uid();
  const wanted = Array.from(new Set(categoryIds.filter(Boolean)));

  const { data: current, error: currentError } = await c
    .from("crm_contact_categories")
    .select("category_id")
    .eq("contact_id", contactId);
  if (currentError) {
    console.warn(
      "[contacts] crm_contact_categories indisponível no salvamento; usando category_id legado:",
      currentError.message,
    );
    const { error } = await c
      .from("crm_contacts")
      .update({ category_id: wanted[0] ?? null })
      .eq("id", contactId);
    if (error) throw error;
    return;
  }
  const currentSet = new Set((current ?? []).map((r: any) => r.category_id));
  const wantedSet = new Set(wanted);

  const toDelete = [...currentSet].filter((id) => !wantedSet.has(id));
  const toInsert = wanted.filter((id) => !currentSet.has(id));

  if (toDelete.length) {
    const { error } = await c
      .from("crm_contact_categories")
      .delete()
      .eq("contact_id", contactId)
      .in("category_id", toDelete);
    if (error) {
      console.warn("[contacts] falha ao remover tags; usando category_id legado:", error.message);
      const { error: legacyError } = await c
        .from("crm_contacts")
        .update({ category_id: wanted[0] ?? null })
        .eq("id", contactId);
      if (legacyError) throw legacyError;
      return;
    }
  }
  if (toInsert.length) {
    const rows = toInsert.map((cid) => ({
      contact_id: contactId,
      category_id: cid,
      user_id,
    }));
    const { error } = await c.from("crm_contact_categories").insert(rows);
    if (error) {
      console.warn("[contacts] falha ao inserir tags; usando category_id legado:", error.message);
      const { error: legacyError } = await c
        .from("crm_contacts")
        .update({ category_id: wanted[0] ?? null })
        .eq("id", contactId);
      if (legacyError) throw legacyError;
      return;
    }
  }
}

/**
 * Carrega todas as tags (M:N) com SELECT simples (sem embed do PostgREST,
 * que pode estar desatualizado após a migração). Retorna Map<contactId, ids[]>.
 * Se a tabela ainda não existe, retorna Map vazio.
 */
async function loadContactCategoriesMap(): Promise<Map<string, string[]>> {
  const c = await client();
  const map = new Map<string, string[]>();
  const { data, error } = await c
    .from("crm_contact_categories")
    .select("contact_id,category_id,created_at")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[contacts] crm_contact_categories indisponível:", error.message);
    return map;
  }
  for (const row of data ?? []) {
    const list = map.get(row.contact_id) ?? [];
    list.push(row.category_id);
    map.set(row.contact_id, list);
  }
  return map;
}

export const contactsDb = {
  /**
   * Lista contatos individuais. NÃO inclui conversas de grupo (is_group=true)
   * — grupos só aparecem na aba WhatsWeb (Inbox), via {@link listAll}.
   */
  async list(): Promise<Contact[]> {
    const c = await client();
    const [contactsRes, tagsMap] = await Promise.all([
      c
        .from("crm_contacts")
        .select(CONTACT_COLUMNS)
        .eq("is_group", false)
        .order("created_at", { ascending: false }),
      loadContactCategoriesMap(),
    ]);
    if (contactsRes.error) throw contactsRes.error;
    return (contactsRes.data ?? []).map((r: any) => {
      const base = rowToContact(r);
      const tags = tagsMap.get(base.id);
      if (tags && tags.length) base.categoryIds = tags;
      else if (base.categoryId) base.categoryIds = [base.categoryId];
      return base;
    });
  },
  /**
   * Igual a {@link list}, mas inclui também conversas de grupo.
   * Usar APENAS na aba WhatsWeb (Inbox).
   */
  async listAll(): Promise<Contact[]> {
    const c = await client();
    const [contactsRes, tagsMap] = await Promise.all([
      c.from("crm_contacts").select(CONTACT_COLUMNS).order("created_at", { ascending: false }),
      loadContactCategoriesMap(),
    ]);
    if (contactsRes.error) throw contactsRes.error;
    return (contactsRes.data ?? []).map((r: any) => {
      const base = rowToContact(r);
      const tags = tagsMap.get(base.id);
      if (tags && tags.length) base.categoryIds = tags;
      else if (base.categoryId) base.categoryIds = [base.categoryId];
      return base;
    });
  },
  async create(input: Omit<Contact, "id" | "createdAt">): Promise<Contact> {
    const c = await client();
    const user_id = await uid();
    // Prioriza categoryIds; cai pra categoryId se vier só ele
    const tags =
      input.categoryIds && input.categoryIds.length
        ? input.categoryIds
        : input.categoryId
          ? [input.categoryId]
          : [];
    const { data, error } = await c
      .from("crm_contacts")
      .insert({
        user_id,
        name: input.name,
        phone: input.phone,
        email: input.email || null,
        notes: input.notes || null,
        category_id: tags[0] ?? null,
      })
      .select(CONTACT_COLUMNS)
      .single();
    if (error) throw error;
    const created = rowToContact(data);
    if (tags.length) {
      await setContactCategories(created.id, tags);
      created.categoryIds = tags;
      created.categoryId = tags[0] ?? null;
      // Dispara gatilhos para cada tag com sequência associada
      for (const cid of tags) {
        await maybeTriggerCategorySequence(created.id, cid);
      }
    }
    return created;
  },
  async update(id: string, patch: Partial<Omit<Contact, "id" | "createdAt">>) {
    const c = await client();
    const dbPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.phone !== undefined) dbPatch.phone = patch.phone;
    if (patch.email !== undefined) dbPatch.email = patch.email || null;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes || null;
    if (patch.aiPersonaSummary !== undefined)
      dbPatch.ai_persona_summary = patch.aiPersonaSummary || null;
    if (patch.urgencyLevel !== undefined) dbPatch.urgency_level = patch.urgencyLevel || null;
    if (patch.lastAiSync !== undefined) dbPatch.last_ai_sync = patch.lastAiSync || null;

    // Estado anterior das tags (para detectar novas e disparar gatilhos)
    let prevTags: Set<string> = new Set();
    if (patch.categoryIds !== undefined || patch.categoryId !== undefined) {
      const { data: prev, error: prevError } = await c
        .from("crm_contact_categories")
        .select("category_id")
        .eq("contact_id", id);
      if (prevError)
        console.warn(
          "[contacts] crm_contact_categories indisponível para diff de tags:",
          prevError.message,
        );
      else prevTags = new Set((prev ?? []).map((r: any) => r.category_id));
    }

    if (Object.keys(dbPatch).length) {
      const { error } = await c.from("crm_contacts").update(dbPatch).eq("id", id);
      if (error) throw error;
    }

    // Atualiza tags. Prioriza categoryIds; senão, usa categoryId (single).
    let nextTags: string[] | null = null;
    if (patch.categoryIds !== undefined) {
      nextTags = patch.categoryIds ?? [];
    } else if (patch.categoryId !== undefined) {
      nextTags = patch.categoryId ? [patch.categoryId] : [];
    }
    if (nextTags !== null) {
      await setContactCategories(id, nextTags);
      // Dispara gatilho para cada tag NOVA
      for (const cid of nextTags) {
        if (!prevTags.has(cid)) {
          await maybeTriggerCategorySequence(id, cid);
        }
      }
    }
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
    const { data: existing } = await c.from("crm_contacts").select("phone");
    const existingNorm = new Set(
      (existing ?? []).map((e: any) => String(e.phone).replace(/\D/g, "")),
    );

    const toInsert: any[] = [];
    const tagsByPhone = new Map<string, string[]>();
    let skipped = 0;
    const seenInBatch = new Set<string>();
    for (const r of rows) {
      const norm = r.phone.replace(/\D/g, "");
      if (!norm || existingNorm.has(norm) || seenInBatch.has(norm)) {
        skipped++;
        continue;
      }
      seenInBatch.add(norm);
      const tags =
        r.categoryIds && r.categoryIds.length ? r.categoryIds : r.categoryId ? [r.categoryId] : [];
      tagsByPhone.set(norm, tags);
      toInsert.push({
        user_id,
        name: r.name,
        phone: r.phone,
        email: r.email || null,
        notes: r.notes || null,
        category_id: tags[0] ?? null,
      });
    }
    if (toInsert.length === 0) return { imported: 0, skipped };
    const { data: inserted, error } = await c
      .from("crm_contacts")
      .insert(toInsert)
      .select("id,phone");
    if (error) throw error;
    // Replica nas tags
    const ccRows: any[] = [];
    for (const row of inserted ?? []) {
      const norm = String(row.phone).replace(/\D/g, "");
      const tags = tagsByPhone.get(norm) ?? [];
      for (const cid of tags) {
        ccRows.push({ contact_id: row.id, category_id: cid, user_id });
      }
    }
    if (ccRows.length) {
      const { error: ccErr } = await c.from("crm_contact_categories").insert(ccRows);
      if (ccErr) console.error("bulkImport contact_categories", ccErr);
    }
    return { imported: toInsert.length, skipped };
  },
  /** API pública para a UI: definir as tags de um contato. */
  setCategories: setContactCategories,
};

// ===================== Pipeline =====================

function rowToStage(r: any): PipelineStage {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    order: r.order,
    sequenceId: r.sequence_id ?? null,
  };
}

export const pipelineDb = {
  async listStages(): Promise<PipelineStage[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_pipeline_stages")
      .select('id,name,color,"order",sequence_id')
      .order("order", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(rowToStage);
  },
  async listPlacements(): Promise<PipelinePlacement[]> {
    const c = await client();
    const { data, error } = await c.from("crm_pipeline_placements").select("contact_id,stage_id");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ contactId: r.contact_id, stageId: r.stage_id }));
  },
  async createStage(
    name: string,
    color: string,
    sequenceId?: string | null,
  ): Promise<PipelineStage> {
    const c = await client();
    const user_id = await uid();
    // Calcula próximo order
    const { data: existing } = await c
      .from("crm_pipeline_stages")
      .select('"order"')
      .order("order", { ascending: false })
      .limit(1);
    const nextOrder = existing && existing[0]?.order != null ? existing[0].order + 1 : 0;
    const { data, error } = await c
      .from("crm_pipeline_stages")
      .insert({ user_id, name, color, order: nextOrder, sequence_id: sequenceId ?? null })
      .select('id,name,color,"order",sequence_id')
      .single();
    if (error) throw error;
    return rowToStage(data);
  },
  async updateStage(
    id: string,
    patch: Partial<Pick<PipelineStage, "name" | "color" | "sequenceId">>,
  ) {
    const c = await client();
    const dbPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.color !== undefined) dbPatch.color = patch.color;
    if (patch.sequenceId !== undefined) dbPatch.sequence_id = patch.sequenceId;
    const { error } = await c.from("crm_pipeline_stages").update(dbPatch).eq("id", id);
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
    // Gatilho automático: se a etapa tem sequência associada, inscreve.
    const { data: stage } = await c
      .from("crm_pipeline_stages")
      .select("sequence_id")
      .eq("id", stageId)
      .maybeSingle();
    const seqId = stage?.sequence_id;
    if (seqId) {
      await sequencesDb.enrollFromTrigger(contactId, seqId);
    }
    // Auto-stop: pausa sequências ativas que tenham essa etapa em stop_on_stage_ids.
    const { data: stopSeqs } = await c
      .from("crm_sequences")
      .select("id")
      .contains("stop_on_stage_ids", [stageId]);
    const ids = (stopSeqs ?? []).map((s: any) => s.id);
    if (ids.length > 0) {
      await c
        .from("crm_contact_sequences")
        .update({
          status: "paused",
          paused_at: new Date().toISOString(),
          pause_reason: "pipeline_stage",
        })
        .eq("contact_id", contactId)
        .eq("status", "active")
        .in("sequence_id", ids);
    }
  },
};

// ===================== Mensagens (Inbox) =====================

const MESSAGE_COLUMNS =
  "id,contact_id,body,from_me,at,type,media_url,media_mime,media_caption,status";

function rowToMessage(r: any): ChatMessage {
  return {
    id: r.id,
    contactId: r.contact_id,
    body: r.body,
    fromMe: r.from_me,
    at: r.at,
    type: (r.type ?? "text") as ChatMessageType,
    mediaUrl: r.media_url ?? null,
    mediaMime: r.media_mime ?? null,
    mediaCaption: r.media_caption ?? null,
    status: r.status ?? null,
  };
}

export const messagesDb = {
  rowToMessage,
  async list(contactId: string): Promise<ChatMessage[]> {
    const c = await client();
    // Tenta com as colunas novas; se falhar (schema cache antigo), faz fallback.
    const full = await c
      .from("crm_messages")
      .select(MESSAGE_COLUMNS)
      .eq("contact_id", contactId)
      .order("at", { ascending: true });
    if (!full.error) return (full.data ?? []).map(rowToMessage);
    console.warn("[messagesDb] fallback sem colunas de mídia:", full.error.message);
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
      type: "text" as ChatMessageType,
    }));
  },
  async send(contactId: string, body: string): Promise<ChatMessage> {
    const c = await client();
    const user_id = await uid();
    const { data, error } = await c
      .from("crm_messages")
      .insert({ user_id, contact_id: contactId, body, from_me: true, type: "text" })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error) throw error;
    return rowToMessage(data);
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
    // Sweeper: marca como "error" qualquer disparo travado em in_progress há
    // mais de 15 min. Worker pode ter sido derrubado (timeout, deploy) sem
    // gravar o status final, deixando o card eternamente em "Enviando".
    const staleCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    await c
      .from("crm_bulk_sends")
      .update({ status: "error" })
      .eq("status", "in_progress")
      .lt("created_at", staleCutoff);
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
    stopOnStageIds: r.stop_on_stage_ids ?? [],
    autoResumeAfterDays: r.auto_resume_after_days ?? 0,
    createdAt: r.created_at,
  };
}

const SEQ_COLS =
  "id,name,description,is_active,trigger_type,trigger_value,window_start_hour,window_end_hour,window_days,stop_on_stage_ids,auto_resume_after_days,created_at";

function rowToStep(r: any): SequenceStep {
  return {
    id: r.id,
    sequenceId: r.sequence_id,
    order: r.order,
    message: r.message,
    delayValue: r.delay_value,
    delayUnit: r.delay_unit,
    typingSeconds: r.typing_seconds ?? 0,
  };
}

const STEP_COLS =
  'id,sequence_id,"order",message,delay_value,delay_unit,typing_seconds';

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
      .select(SEQ_COLS)
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
      .select(SEQ_COLS)
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
      stopOnStageIds: string[];
      autoResumeAfterDays: number;
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
    if (patch.stopOnStageIds !== undefined) dbPatch.stop_on_stage_ids = patch.stopOnStageIds;
    if (patch.autoResumeAfterDays !== undefined)
      dbPatch.auto_resume_after_days = patch.autoResumeAfterDays;
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
      .select(STEP_COLS)
      .eq("sequence_id", sequenceId)
      .order("order", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(rowToStep);
  },

  async saveSteps(
    sequenceId: string,
    steps: Array<{
      message: string;
      delayValue: number;
      delayUnit: "hours" | "days";
      typingSeconds?: number;
    }>,
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
      typing_seconds: Math.max(0, Math.min(60, s.typingSeconds ?? 0)),
    }));
    const { error } = await c.from("crm_sequence_steps").insert(rows);
    if (error) throw error;
  },

  /**
   * Métricas por passo: contatos atualmente aguardando, enviados (do log)
   * e quantos receberam pelo menos 1 mensagem inbound após o envio.
   */
  async stepMetrics(sequenceId: string): Promise<SequenceStepMetric[]> {
    const c = await client();
    const [stepsRes, csRes, logRes] = await Promise.all([
      c
        .from("crm_sequence_steps")
        .select('"order"')
        .eq("sequence_id", sequenceId),
      c
        .from("crm_contact_sequences")
        .select("current_step,status")
        .eq("sequence_id", sequenceId)
        .eq("status", "active"),
      c
        .from("crm_sequence_send_log")
        .select("contact_sequence_id,step_order,sent_at,status")
        .eq("status", "sent")
        .in(
          "contact_sequence_id",
          (
            await c
              .from("crm_contact_sequences")
              .select("id")
              .eq("sequence_id", sequenceId)
          ).data?.map((r: any) => r.id) ?? [],
        ),
    ]);
    if (stepsRes.error) throw stepsRes.error;
    if (csRes.error) throw csRes.error;
    if (logRes.error) throw logRes.error;

    const orders = (stepsRes.data ?? []).map((s: any) => s.order as number);
    if (orders.length === 0) return [];

    const waitingByOrder = new Map<number, number>();
    for (const r of csRes.data ?? []) {
      const k = r.current_step as number;
      waitingByOrder.set(k, (waitingByOrder.get(k) ?? 0) + 1);
    }

    // sent + replied: precisa cruzar com mensagens inbound do contato
    const sentByOrder = new Map<number, number>();
    const repliedByOrder = new Map<number, number>();

    const logs = logRes.data ?? [];
    if (logs.length === 0) {
      return orders.map((o) => ({
        order: o,
        waiting: waitingByOrder.get(o) ?? 0,
        sent: 0,
        replied: 0,
        responseRate: 0,
      }));
    }

    // Resolve contact_id via crm_contact_sequences
    const csIds = [...new Set(logs.map((l: any) => l.contact_sequence_id))];
    const { data: csRows } = await c
      .from("crm_contact_sequences")
      .select("id,contact_id")
      .in("id", csIds);
    const csToContact = new Map<string, string>(
      (csRows ?? []).map((r: any) => [r.id, r.contact_id]),
    );

    // Inbound mais antiga depois do envio do step
    const contactIds = [...new Set([...csToContact.values()])];
    const { data: inbound } = contactIds.length
      ? await c
          .from("crm_messages")
          .select("contact_id,at,from_me")
          .in("contact_id", contactIds)
          .eq("from_me", false)
      : { data: [] as any[] };

    const inboundByContact = new Map<string, string[]>();
    for (const m of inbound ?? []) {
      const arr = inboundByContact.get(m.contact_id) ?? [];
      arr.push(m.at);
      inboundByContact.set(m.contact_id, arr);
    }

    for (const log of logs) {
      const o = log.step_order as number;
      sentByOrder.set(o, (sentByOrder.get(o) ?? 0) + 1);
      const contactId = csToContact.get(log.contact_sequence_id);
      if (!contactId) continue;
      const ats = inboundByContact.get(contactId) ?? [];
      const sentAt = new Date(log.sent_at).getTime();
      if (ats.some((a) => new Date(a).getTime() > sentAt)) {
        repliedByOrder.set(o, (repliedByOrder.get(o) ?? 0) + 1);
      }
    }

    return orders.map((o) => {
      const sent = sentByOrder.get(o) ?? 0;
      const replied = repliedByOrder.get(o) ?? 0;
      return {
        order: o,
        waiting: waitingByOrder.get(o) ?? 0,
        sent,
        replied,
        responseRate: sent > 0 ? replied / sent : 0,
      };
    });
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
      ? first.delay_value * (first.delay_unit === "hours" ? 3600_000 : 86_400_000)
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
    const { error, count } = await c.from("crm_contact_sequences").upsert(rows, {
      onConflict: "contact_id,sequence_id",
      ignoreDuplicates: true,
      count: "exact",
    });
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

  async removeContact(contactSequenceId: string) {
    const c = await client();
    const { error } = await c
      .from("crm_contact_sequences")
      .delete()
      .eq("id", contactSequenceId);
    if (error) throw error;
  },

  /**
   * Pausa todas as sequências ativas de um contato (exceto a indicada).
   * Usada antes de inscrever em uma nova sequência via gatilho automático.
   */
  async pauseAllActiveForContact(
    contactId: string,
    exceptSequenceId?: string,
    reason = "auto_replaced",
  ) {
    const c = await client();
    let q = c
      .from("crm_contact_sequences")
      .update({ status: "paused", paused_at: new Date().toISOString(), pause_reason: reason })
      .eq("contact_id", contactId)
      .eq("status", "active");
    if (exceptSequenceId) q = q.neq("sequence_id", exceptSequenceId);
    const { error } = await q;
    if (error) throw error;
  },

  /**
   * Inscreve um contato em uma sequência via gatilho automático.
   * Política: pausa qualquer sequência ativa anterior antes de iniciar a nova.
   * Se o contato já estiver ativo NESTA sequência, não faz nada.
   */
  async enrollFromTrigger(contactId: string, sequenceId: string): Promise<{ enrolled: boolean }> {
    const c = await client();
    // Verifica se já está ativo nessa sequência
    const { data: existing } = await c
      .from("crm_contact_sequences")
      .select("id,status")
      .eq("contact_id", contactId)
      .eq("sequence_id", sequenceId)
      .maybeSingle();
    if (existing && existing.status === "active") {
      return { enrolled: false };
    }
    // Pausa as outras ativas
    await sequencesDb.pauseAllActiveForContact(contactId, sequenceId, "auto_replaced");
    // Se existe registro pausado/cancelado, reativa; senão cria novo
    if (existing) {
      const { error } = await c
        .from("crm_contact_sequences")
        .update({
          status: "active",
          current_step: 0,
          paused_at: null,
          pause_reason: null,
          started_at: new Date().toISOString(),
          next_send_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) throw error;
      return { enrolled: true };
    }
    const r = await sequencesDb.enroll(sequenceId, [contactId]);
    return { enrolled: r.enrolled > 0 };
  },
};

export type CaptureWidget = {
  id: string;
  name: string;
  categoryId: string | null;
  stageId: string | null;
  title: string;
  subtitle: string | null;
  buttonText: string;
  primaryColor: string;
  successMessage: string;
  sourceTag: string | null;
  isActive: boolean;
  submissionsCount: number;
  createdAt: string;
};

function rowToWidget(r: any): CaptureWidget {
  return {
    id: r.id,
    name: r.name,
    categoryId: r.category_id ?? null,
    stageId: r.stage_id ?? null,
    title: r.title,
    subtitle: r.subtitle ?? null,
    buttonText: r.button_text,
    primaryColor: r.primary_color,
    successMessage: r.success_message,
    sourceTag: r.source_tag ?? null,
    isActive: r.is_active,
    submissionsCount: r.submissions_count ?? 0,
    createdAt: r.created_at,
  };
}

export const widgetsDb = {
  async list(): Promise<CaptureWidget[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_capture_widgets")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToWidget);
  },
  async create(input: {
    name: string;
    categoryId?: string | null;
    stageId?: string | null;
    title?: string;
    subtitle?: string | null;
    buttonText?: string;
    primaryColor?: string;
    successMessage?: string;
    sourceTag?: string | null;
  }): Promise<CaptureWidget> {
    const c = await client();
    const user_id = await uid();
    const { data, error } = await c
      .from("crm_capture_widgets")
      .insert({
        user_id,
        name: input.name,
        category_id: input.categoryId || null,
        stage_id: input.stageId || null,
        title: input.title ?? "Fale com a gente",
        subtitle: input.subtitle ?? "Preencha e retornaremos em breve.",
        button_text: input.buttonText ?? "Enviar",
        primary_color: input.primaryColor ?? "#10B981",
        success_message:
          input.successMessage ?? "Recebemos sua mensagem! Entraremos em contato em breve.",
        source_tag: input.sourceTag ?? "site",
      })
      .select("*")
      .single();
    if (error) throw error;
    return rowToWidget(data);
  },
  async update(
    id: string,
    patch: Partial<Omit<CaptureWidget, "id" | "createdAt" | "submissionsCount">>,
  ) {
    const c = await client();
    const dbPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.categoryId !== undefined) dbPatch.category_id = patch.categoryId || null;
    if (patch.stageId !== undefined) dbPatch.stage_id = patch.stageId || null;
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.subtitle !== undefined) dbPatch.subtitle = patch.subtitle;
    if (patch.buttonText !== undefined) dbPatch.button_text = patch.buttonText;
    if (patch.primaryColor !== undefined) dbPatch.primary_color = patch.primaryColor;
    if (patch.successMessage !== undefined) dbPatch.success_message = patch.successMessage;
    if (patch.sourceTag !== undefined) dbPatch.source_tag = patch.sourceTag;
    if (patch.isActive !== undefined) dbPatch.is_active = patch.isActive;
    const { error } = await c.from("crm_capture_widgets").update(dbPatch).eq("id", id);
    if (error) throw error;
  },
  async remove(id: string) {
    const c = await client();
    const { error } = await c.from("crm_capture_widgets").delete().eq("id", id);
    if (error) throw error;
  },
};

// ===================== Templates de mensagem =====================

function rowToTemplate(r: any): MessageTemplate {
  return {
    id: r.id,
    name: r.name,
    content: r.content,
    category: r.category ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const templatesDb = {
  async list(): Promise<MessageTemplate[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_message_templates")
      .select("id,name,content,category,created_at,updated_at")
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(rowToTemplate);
  },

  async create(input: {
    name: string;
    content: string;
    category?: string | null;
  }): Promise<MessageTemplate> {
    const c = await client();
    const user_id = await uid();
    const { data, error } = await c
      .from("crm_message_templates")
      .insert({
        user_id,
        name: input.name,
        content: input.content,
        category: input.category ?? null,
      })
      .select("id,name,content,category,created_at,updated_at")
      .single();
    if (error) throw error;
    return rowToTemplate(data);
  },

  async update(
    id: string,
    patch: Partial<{ name: string; content: string; category: string | null }>,
  ) {
    const c = await client();
    const { error } = await c.from("crm_message_templates").update(patch).eq("id", id);
    if (error) throw error;
  },

  async remove(id: string) {
    const c = await client();
    const { error } = await c.from("crm_message_templates").delete().eq("id", id);
    if (error) throw error;
  },
};

// ===================== Configurações do Usuário (IA) =====================

export type UserSettings = {
  interestTerms: string[];
  rescanWebhookUrl: string | null;
  testPhone: string | null;
  updatedAt: string | null;
};

export const userSettingsDb = {
  async get(): Promise<UserSettings> {
    const c = await client();
    const user_id = await uid();
    const { data, error } = await c
      .from("crm_user_settings")
      .select("interest_terms,rescan_webhook_url,test_phone,updated_at")
      .eq("user_id", user_id)
      .maybeSingle();
    if (error) throw error;
    return {
      interestTerms: Array.isArray(data?.interest_terms) ? (data!.interest_terms as string[]) : [],
      rescanWebhookUrl: data?.rescan_webhook_url ?? null,
      testPhone: data?.test_phone ?? null,
      updatedAt: data?.updated_at ?? null,
    };
  },
  async save(patch: {
    interestTerms?: string[];
    rescanWebhookUrl?: string | null;
    testPhone?: string | null;
  }): Promise<void> {
    const c = await client();
    const user_id = await uid();
    const row: Record<string, unknown> = { user_id };
    if (patch.interestTerms !== undefined) row.interest_terms = patch.interestTerms;
    if (patch.rescanWebhookUrl !== undefined) row.rescan_webhook_url = patch.rescanWebhookUrl;
    if (patch.testPhone !== undefined) row.test_phone = patch.testPhone;
    const { error } = await c
      .from("crm_user_settings")
      .upsert(row, { onConflict: "user_id" });
    if (error) throw error;
  },
};

// ===================== Blacklist (números ignorados) =====================

export type IgnoredPhone = {
  id: string;
  phoneNorm: string;
  reason: string | null;
  createdAt: string;
};

export function normalizePhoneStr(p: string): string {
  return String(p ?? "").replace(/\D/g, "");
}

/**
 * Faz o parse de um textarea contendo telefones (um por linha ou separados
 * por vírgula/;) e devolve a lista de phone_norm únicos e válidos (6–20 dígitos).
 */
export function parseBlacklistInput(raw: string): string[] {
  const tokens = raw.split(/[\s,;]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const n = normalizePhoneStr(t);
    if (!n) continue;
    if (n.length < 6 || n.length > 20) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export const ignoredPhonesDb = {
  async list(): Promise<IgnoredPhone[]> {
    const c = await client();
    const { data, error } = await c
      .from("crm_ignored_phones")
      .select("id,phone_norm,reason,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      phoneNorm: r.phone_norm,
      reason: r.reason ?? null,
      createdAt: r.created_at,
    }));
  },
  /** Substitui toda a blacklist do usuário pela lista enviada (replace). */
  async replaceAll(phoneNorms: string[], reason?: string | null): Promise<{ added: number; removed: number; kept: number }> {
    const c = await client();
    const user_id = await uid();
    const wanted = new Set(phoneNorms.filter(Boolean));
    const { data: current, error: curErr } = await c
      .from("crm_ignored_phones")
      .select("id,phone_norm")
      .eq("user_id", user_id);
    if (curErr) throw curErr;
    const currentMap = new Map<string, string>(
      (current ?? []).map((r: any) => [r.phone_norm, r.id]),
    );
    const toRemove = [...currentMap.entries()]
      .filter(([norm]) => !wanted.has(norm))
      .map(([, id]) => id);
    const toAdd = [...wanted].filter((n) => !currentMap.has(n));

    if (toRemove.length) {
      const { error } = await c
        .from("crm_ignored_phones")
        .delete()
        .in("id", toRemove);
      if (error) throw error;
    }
    if (toAdd.length) {
      const rows = toAdd.map((phone_norm) => ({
        user_id,
        phone_norm,
        reason: reason || null,
      }));
      const { error } = await c.from("crm_ignored_phones").insert(rows);
      if (error) throw error;
    }
    return { added: toAdd.length, removed: toRemove.length, kept: currentMap.size - toRemove.length };
  },
  async addOne(phone: string, reason?: string | null): Promise<void> {
    const c = await client();
    const user_id = await uid();
    const phone_norm = normalizePhoneStr(phone);
    if (phone_norm.length < 6) throw new Error("Telefone inválido");
    const { error } = await c
      .from("crm_ignored_phones")
      .upsert({ user_id, phone_norm, reason: reason || null }, { onConflict: "user_id,phone_norm" });
    if (error) throw error;
  },
  async removeOne(phoneNorm: string): Promise<void> {
    const c = await client();
    const { error } = await c
      .from("crm_ignored_phones")
      .delete()
      .eq("phone_norm", phoneNorm);
    if (error) throw error;
  },
  /** Remove pela versão original do telefone (normaliza antes). */
  async removeByPhone(phone: string): Promise<void> {
    const phone_norm = normalizePhoneStr(phone);
    if (!phone_norm) return;
    const c = await client();
    const { error } = await c
      .from("crm_ignored_phones")
      .delete()
      .eq("phone_norm", phone_norm);
    if (error) throw error;
  },
  /** Adiciona vários telefones em lote (normaliza e dedupe). Retorna quantos foram inseridos. */
  async addMany(phones: string[], reason?: string | null): Promise<{ added: number; skipped: number }> {
    const c = await client();
    const user_id = await uid();
    const seen = new Set<string>();
    const norms: string[] = [];
    for (const p of phones) {
      const n = normalizePhoneStr(p);
      if (!n || n.length < 6 || seen.has(n)) continue;
      seen.add(n);
      norms.push(n);
    }
    if (norms.length === 0) return { added: 0, skipped: phones.length };
    const rows = norms.map((phone_norm) => ({ user_id, phone_norm, reason: reason || null }));
    const { error, data } = await c
      .from("crm_ignored_phones")
      .upsert(rows, { onConflict: "user_id,phone_norm", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    const added = (data ?? []).length;
    return { added, skipped: phones.length - added };
  },
};
