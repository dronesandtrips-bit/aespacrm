import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "@/integrations/supabase/server";

const isE164 = (p: string | null | undefined) => !!p && /^\d{10,15}$/.test(p);
const looksLikeJidName = (n: string | null | undefined) =>
  !!n && (String(n).includes("@") || /^\d{14,}$/.test(String(n).trim()));

function classify(rows: Array<{ id: string; name: string | null; phone: string | null; phone_norm: string | null }>) {
  return rows.filter((c) => {
    const badPhone = !isE164(c.phone_norm) && !isE164(c.phone);
    const badName = looksLikeJidName(c.name);
    return badPhone || badName;
  });
}

export const previewInvalidContacts = createServerFn({ method: "GET" }).handler(async () => {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("crm_contacts")
    .select("id,name,phone,phone_norm");
  if (error) throw new Error(error.message);
  const trash = classify((data ?? []) as any);
  return {
    total: data?.length ?? 0,
    invalid: trash.length,
    sample: trash.slice(0, 10).map((c) => ({ id: c.id, name: c.name, phone_norm: c.phone_norm })),
  };
});

export const deleteInvalidContacts = createServerFn({ method: "POST" }).handler(async () => {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("crm_contacts")
    .select("id,name,phone,phone_norm");
  if (error) throw new Error(error.message);
  const trash = classify((data ?? []) as any);
  if (trash.length === 0) return { deleted: 0, remaining: data?.length ?? 0 };

  const ids = trash.map((c) => c.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const { error: delErr, count } = await sb
      .from("crm_contacts")
      .delete({ count: "exact" })
      .in("id", batch);
    if (delErr) throw new Error(delErr.message);
    deleted += count ?? batch.length;
  }
  return { deleted, remaining: (data?.length ?? 0) - deleted };
});
