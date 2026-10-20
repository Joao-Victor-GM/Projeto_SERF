// Tipos dos objetos globais do front-end (scripts clássicos, sem build).
// Usados pela checagem de tipos (tsconfig.json); o navegador nunca lê isto.

import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type { Database } from "./banco";

export type Cliente = SupabaseClient<Database>;
export type Linha<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Atualizacao<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
export type LinhaView<V extends keyof Database["public"]["Views"]> = Database["public"]["Views"][V]["Row"];

export interface SERFDadosBase {
    cliente(): Cliente;
    dadosOuErro<T>(resultado: { data: T; error: unknown }): T;
    assinar(opcoes: {
        canal: string;
        tabela: keyof Database["public"]["Tables"];
        evento?: "*" | "INSERT" | "UPDATE" | "DELETE";
        filtro?: string;
        aoReceber: (payload: any) => void;
        aoMudarStatus?: (status: string) => void;
    }): RealtimeChannel | null;
    cancelarAssinatura(canal: RealtimeChannel | null): void;
}

declare global {
    interface Window {
        obterSupabase?: () => Cliente | null;
        supabaseClient?: Cliente;
        serfSessao: Promise<unknown>;
        SERFUtils: any;
        SERFDados: { base: SERFDadosBase } & Record<string, any>;
        SERFAvisos: any;
        [outro: string]: any;
    }

    function obterSupabase(): Cliente | null;
    const Swal: any;
}

export {};
