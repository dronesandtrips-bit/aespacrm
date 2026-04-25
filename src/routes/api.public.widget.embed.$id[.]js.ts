// GET /api/public/widget/embed/:id.js
// Devolve um JS que injeta um iframe do form no site do cliente.
// Uso no site: <script src="https://aespacrm.lovable.app/api/public/widget/embed/<ID>.js" async></script>
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/widget/embed/$id.js")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const id = params.id.replace(/[^a-zA-Z0-9-]/g, "");
        const url = new URL(request.url);
        const base = `${url.protocol}//${url.host}`;
        const formUrl = `${base}/widget/form/${id}`;

        const js = `(function(){
  try {
    var WID = ${JSON.stringify(id)};
    var FORM = ${JSON.stringify(formUrl)};
    var current = document.currentScript;
    var mount = document.createElement('div');
    mount.id = 'zapcrm-widget-' + WID;
    mount.style.cssText = 'width:100%;max-width:480px;margin:0 auto;';
    var iframe = document.createElement('iframe');
    iframe.src = FORM;
    iframe.style.cssText = 'width:100%;border:0;height:520px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);background:transparent;';
    iframe.setAttribute('loading','lazy');
    iframe.setAttribute('title','Formulário de contato');
    mount.appendChild(iframe);
    if (current && current.parentNode) {
      current.parentNode.insertBefore(mount, current);
    } else {
      document.body.appendChild(mount);
    }
    // Auto-resize via postMessage
    window.addEventListener('message', function(e){
      try {
        if (!e.data || e.data.type !== 'zapcrm:resize' || e.data.id !== WID) return;
        if (typeof e.data.height === 'number') {
          iframe.style.height = (e.data.height + 16) + 'px';
        }
      } catch(_){}
    });
  } catch(err) { console.error('[zapcrm widget]', err); }
})();`;

        return new Response(js, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },
    },
  },
});
