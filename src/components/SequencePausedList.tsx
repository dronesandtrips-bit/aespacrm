import { useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pauseLabels, spTime, type MonitorEnrollment, type MonitorSequence } from "@/lib/sequence-monitor";

export function SequencePausedList({ enrollments, sequences }: { enrollments: MonitorEnrollment[]; sequences: MonitorSequence[] }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<MonitorEnrollment | null>(null);
  const sequenceNames = new Map(sequences.map(s => [s.id, s.name]));
  const reason = (e: MonitorEnrollment) => pauseLabels[e.pause_reason ?? ""] ?? e.pause_reason ?? "Motivo não registrado";
  const filtered = enrollments.filter(e => `${e.crm_contacts?.name ?? ""} ${e.crm_contacts?.phone ?? ""} ${sequenceNames.get(e.sequence_id) ?? ""} ${reason(e)}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const current = Math.min(page, pages);
  return <div className="space-y-4">
    <div className="relative max-w-lg"><Search className="size-4 absolute left-3 top-3 text-muted-foreground" /><Input aria-label="Buscar inscrições pausadas" placeholder="Contato, telefone, sequência ou motivo" className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
    <div className="overflow-x-auto border rounded-lg"><table className="w-full text-sm"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>{["Contato / telefone", "Sequência", "Motivo da pausa", "Pausado em · São Paulo", "Etapa", "Detalhes"].map(t => <th key={t} className="p-3 font-medium">{t}</th>)}</tr></thead><tbody className="divide-y">{filtered.slice((current - 1) * 25, current * 25).map(e => <tr key={e.id}>
      <td className="p-3 min-w-48"><p className="font-medium">{e.crm_contacts?.name ?? "Contato removido"}</p><p className="text-xs text-muted-foreground">{e.crm_contacts?.phone ?? "—"}</p></td>
      <td className="p-3">{sequenceNames.get(e.sequence_id) ?? "Sequência removida"}</td><td className="p-3">{reason(e)}</td><td className="p-3 whitespace-nowrap text-xs">{spTime(e.paused_at ?? null)}</td><td className="p-3">{e.current_step}</td>
      <td className="p-3"><Button variant="ghost" size="icon" aria-label={`Ver inscrição de ${e.crm_contacts?.name ?? "contato removido"}`} title="Ver detalhes da inscrição" onClick={() => setDetail(e)}><Eye className="size-4" /></Button></td>
    </tr>)}</tbody></table>{!filtered.length && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma inscrição pausada encontrada para estes filtros.</p>}</div>
    <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-muted-foreground"><span>{filtered.length} inscrições · Página {current} de {pages}</span><div className="flex gap-1"><Button variant="outline" size="icon" aria-label="Inscrições anteriores" disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft className="size-4" /></Button><Button variant="outline" size="icon" aria-label="Próximas inscrições" disabled={current >= pages} onClick={() => setPage(current + 1)}><ChevronRight className="size-4" /></Button></div></div>
    <Dialog open={Boolean(detail)} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Detalhes da inscrição pausada</DialogTitle></DialogHeader>{detail && <dl className="space-y-3 text-sm break-words">
      <div><dt className="text-muted-foreground">Contato</dt><dd>{detail.crm_contacts?.name ?? "Contato removido"} · {detail.crm_contacts?.phone ?? "—"}</dd></div>
      <div><dt className="text-muted-foreground">Sequência</dt><dd>{sequenceNames.get(detail.sequence_id) ?? "Sequência removida"}</dd></div>
      <div><dt className="text-muted-foreground">Motivo da pausa</dt><dd>{reason(detail)}</dd></div>
      <div><dt className="text-muted-foreground">Pausado em · São Paulo</dt><dd>{spTime(detail.paused_at ?? null)}</dd></div>
      <div><dt className="text-muted-foreground">Etapa registrada</dt><dd>{detail.current_step}</dd></div>
      <div><dt className="text-muted-foreground">Inscrição iniciada em</dt><dd>{spTime(detail.started_at)}</dd></div>
      <div><dt className="text-muted-foreground">Excluído dos envios</dt><dd>{detail.crm_contacts?.is_ignored ? "Sim" : "Não"}</dd></div>
      <div><dt className="text-muted-foreground">Registro da inscrição</dt><dd className="break-all">{detail.id}</dd></div>
    </dl>}</DialogContent></Dialog>
  </div>;
}