import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { dateBounds, emptySnapshot, spDay, type MonitorSnapshot } from "@/lib/sequence-monitor";

type PageResult = { data: unknown[] | null; error: { message: string } | null };
export async function readAllPages<T>(query: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error(result.error.message);
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export function useSequenceMonitor(userId: string | undefined, start: string, end: string, live: boolean) {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let active = true;
    let busy = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      if (busy || !active || !userId) return;
      busy = true;
      setRefreshing(true);
      try {
        if (start && end && start > end) throw new Error("A data inicial deve ser anterior à data final.");
        const client = await getSupabaseClient();
        if (!client) throw new Error("Não foi possível conectar ao banco do ZapCRM.");
        const db = client.schema("aespacrm");
        const { since, until } = dateBounds(start, end);
        const [sequences, enrollments, logs, steps, occurrenceResult, claimResult] = await Promise.all([
          readAllPages<MonitorSnapshot["sequences"][number]>((from, to) => db.from("crm_sequences")
            .select("id,name,is_active,window_start_hour,window_end_hour,window_days,client_interval_seconds,recurrence_enabled,recurrence_activated_at,next_client_at")
            .eq("user_id", userId).order("id").range(from, to)),
          readAllPages<MonitorSnapshot["enrollments"][number]>((from, to) => db.from("crm_contact_sequences")
            .select("id,sequence_id,contact_id,current_step,status,next_send_at,pause_reason,started_at,crm_contacts(name,phone,is_ignored)")
            .eq("user_id", userId).order("id").range(from, to)),
          readAllPages<MonitorSnapshot["logs"][number]>((from, to) => {
            let query = db.from("crm_sequence_send_log")
              .select("id,contact_sequence_id,step_order,message,status,error,sent_at,occurrence_id,dispatch_claim_id,contact_sequences:crm_contact_sequences(sequence_id,crm_contacts(name,phone,is_ignored),crm_sequences(name))")
              .eq("user_id", userId);
            if (since) query = query.gte("sent_at", since);
            if (until) query = query.lt("sent_at", until);
            return query.order("sent_at", { ascending: false }).order("id").range(from, to);
          }),
          readAllPages<MonitorSnapshot["steps"][number]>((from, to) => db.from("crm_sequence_steps")
            .select("sequence_id,order").eq("user_id", userId).order("id").range(from, to)),
          readAllPages<MonitorSnapshot["occurrences"][number]>((from, to) => {
            let query = db.from("crm_sequence_occurrences")
              .select("id,sequence_id,contact_sequence_id,scheduled_date,scheduled_at,current_step,next_send_at,status,completed_at")
              .eq("user_id", userId);
            // Retain unfinished older rounds even when the selected report period is today.
            const clauses = ["status.eq.active", `scheduled_date.eq.${spDay()}`];
            if (start && end) clauses.push(`and(scheduled_date.gte.${start},scheduled_date.lte.${end})`);
            else if (start) clauses.push(`scheduled_date.gte.${start}`);
            else if (end) clauses.push(`scheduled_date.lte.${end}`);
            if (start || end) query = query.or(clauses.join(","));
            return query.order("scheduled_date", { ascending: false }).order("id").range(from, to);
          }).then(data => ({ data, error: null })).catch((e: Error) => ({ data: [], error: e.message })),
          readAllPages<MonitorSnapshot["claims"][number]>((from, to) => db.from("crm_sequence_dispatches")
            .select("id,sequence_id,contact_sequence_id,occurrence_id,step_order,reserved_at,status")
            .eq("user_id", userId).eq("status", "reserved").order("reserved_at").order("id").range(from, to))
            .then(data => ({ data, error: null })).catch((e: Error) => ({ data: [], error: e.message })),
        ]);
        if (!active) return;
        const warnings: string[] = [];
        if (occurrenceResult.error) warnings.push(`Rodadas indisponíveis: ${occurrenceResult.error}`);
        if (claimResult.error) warnings.push("Confirmações pendentes indisponíveis para esta conta; não é possível afirmar quais envios estão sendo processados ou bloqueados.");
        setSnapshot({ sequences, enrollments, logs, steps, occurrences: occurrenceResult.data,
          claims: claimResult.data, warnings, claimsAvailable: !claimResult.error, occurrencesAvailable: !occurrenceResult.error });
        setUpdatedAt(new Date().toISOString());
        setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Não foi possível atualizar o painel.");
      } finally {
        busy = false;
        if (active) { setLoading(false); setRefreshing(false); }
      }
    };
    refreshRef.current = load;
    void load();
    const timer = window.setInterval(() => { if (live && document.visibilityState === "visible") void load(); }, 15_000);
    const wake = () => { if (live && document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", wake); };
  }, [userId, start, end, live]);
  return { snapshot, loading, refreshing, error, updatedAt, refresh };
}