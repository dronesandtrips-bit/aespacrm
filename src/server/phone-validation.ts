// Validação estrita de telefones para o CRM.
// Regras (acordadas com o produto):
// - E.164 base: 10 a 15 dígitos.
// - Brasil (DDI 55): deve ter EXATAMENTE 12 ou 13 dígitos
//   (55 + DDD 2 dígitos + 8 ou 9 dígitos do número).
// - Rejeita sequências repetidas (ex.: 0000000000, 1111111111)
//   e padrões artificiais comuns (ex.: 1234567890, 0123456789).

const COUNTRY_LENGTHS: Record<string, number[]> = {
  // BR: 55 + DDD(2) + 8 ou 9 dígitos
  "55": [12, 13],
};

function hasLowEntropy(p: string): boolean {
  // Mesmo dígito repetido o tempo todo
  if (/^(\d)\1{9,}$/.test(p)) return true;
  // 6+ zeros consecutivos
  if (/0{6,}/.test(p)) return true;
  // Sequência crescente/decrescente longa (ex.: 1234567890..., 9876543210...)
  if (/0123456789|1234567890|9876543210/.test(p)) return true;
  // Pouquíssimos dígitos únicos para um número longo
  const unique = new Set(p.split("")).size;
  if (p.length >= 12 && unique <= 2) return true;
  return false;
}

export function isStrictValidPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const p = String(phone).replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(p)) return false;
  if (hasLowEntropy(p)) return false;

  // Regras por país (DDI). Hoje só BR; demais caem na regra E.164 genérica.
  for (const ddi of Object.keys(COUNTRY_LENGTHS)) {
    if (p.startsWith(ddi)) {
      return COUNTRY_LENGTHS[ddi].includes(p.length);
    }
  }
  return true;
}

export function looksLikeJidOrIdName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = String(name).trim();
  if (!n) return false;
  if (n.includes("@")) return true;
  // Nome puramente numérico longo é provável ID técnico
  if (/^\d{12,}$/.test(n)) return true;
  return false;
}
