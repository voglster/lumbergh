(function() {
  var API = 'https://app.lumbergh.dev/api/telemetry/web';
  var vid = localStorage.getItem('lb_vid');
  if (!vid) { vid = crypto.randomUUID(); localStorage.setItem('lb_vid', vid); }

  function send(events) {
    try {
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor_id: vid, events: events }), keepalive: true });
    } catch(e) {}
  }

  // Track page view on load and on SPA navigation (MkDocs Material uses instant loading)
  function trackPageView() {
    send([{ event: 'page_view', url: location.href, referrer: document.referrer, properties: { source: 'docs' } }]);
  }

  trackPageView();

  // MkDocs Material instant loading fires a custom event on navigation
  if (typeof document$ !== 'undefined') {
    document$.subscribe(function() { trackPageView(); });
  }
})();
