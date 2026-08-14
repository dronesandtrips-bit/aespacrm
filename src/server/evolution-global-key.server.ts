// Resolve a Global API Key da Evolution: cofre (crm_app_secrets) com
// fallback para a variável de ambiente EVOLUTION_GLOBAL_API_KEY / EVOLUTION_API_KEY.
import { getSupabaseAdmin } from "@/integrations/supabase/server";

export async function getEvolutionGlobalApiKey(userId?: string): Promise<string> {
  if (userId) {
    try {
      const admin = getSupabaseAdmin();
      const { data } = await admin
        .from("crm_app_secrets")
        .select("value")
        .eq("user_id", userId)
        .eq("name", "EVOLUTION_GLOBAL_API_KEY")
        .maybeSingle();
      if (data?.value) return String(data.value);
    } catch {
      // ignora e cai no fallback de env
    }
  }
  return process.env.EVOLUTION_GLOBAL_API_KEY ?? process.env.EVOLUTION_API_KEY ?? "";
}
