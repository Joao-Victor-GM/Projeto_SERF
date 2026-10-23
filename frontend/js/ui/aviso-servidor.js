// Home em módulos ES: aberta direto do arquivo (file://) não carrega.
// Mostra um aviso claro em vez de uma página quebrada.

if (location.protocol === "file:") {
    document.addEventListener("DOMContentLoaded", () => {
        const aviso = document.createElement("div");
        aviso.setAttribute("role", "alert");
        aviso.style.cssText = "position:fixed;inset:16px 16px auto;z-index:9999;padding:14px 18px;border-radius:8px;background:#B91C1C;color:#fff;font:600 14px/1.5 system-ui,sans-serif";
        aviso.textContent = "A Home precisa ser aberta por um servidor local (ex.: npm run servidor ou a extensão Live Server), não direto do arquivo.";
        document.body.prepend(aviso);
    });
}
