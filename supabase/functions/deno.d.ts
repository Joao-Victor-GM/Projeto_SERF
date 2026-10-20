// O mínimo do runtime Deno usado pelas Edge Functions, para a checagem de
// tipos com o tsc (tsconfig.json) sem instalar o Deno. No deploy, o Supabase
// usa os tipos reais do Deno.

declare namespace Deno {
    function serve(handler: (req: Request) => Response | Promise<Response>): unknown;

    namespace env {
        function get(nome: string): string | undefined;
    }
}
