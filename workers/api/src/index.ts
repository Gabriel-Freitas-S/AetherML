// workers/api/src/index.ts — REST + Cron push (Cloudflare Workers + D1 + R2)
export interface Env { DB: D1Database; MODELS: R2Bucket; VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; }

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/stations') {
      const { results } = await env.DB.prepare('SELECT * FROM monitoring_stations WHERE is_active=1').all();
      return json(results);
    }
    if (url.pathname === '/api/models/manifest') {
      const obj = await env.MODELS.get('manifest.json');
      return json(obj ? await obj.json() : { error: 'manifest ausente — rode ml/training/registry.py' }, obj ? 200 : 404);
    }
    if (url.pathname === '/api/history') {
      const station = url.searchParams.get('station');
      const from = url.searchParams.get('from') ?? '1970-01-01';
      const to = url.searchParams.get('to') ?? '2999-01-01';
      if (!station) return json({ error: { code: 'BAD_STATION', message: 'station obrigatório' } }, 400);
      const { results } = await env.DB.prepare(
        'SELECT * FROM observed_pollutants WHERE station_id=? AND timestamp BETWEEN ? AND ? ORDER BY timestamp'
      ).bind(station, from, to).all();
      return json({ station_id: station, points: results });
    }
    if (req.method === 'POST' && url.pathname === '/api/push/subscribe') {
      const b = await req.json() as any;
      const id = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO web_push_subscriptions (id,endpoint,p256dh,auth,preferred_station_id,min_alert_level) VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET preferred_station_id=excluded.preferred_station_id, min_alert_level=excluded.min_alert_level'
      ).bind(id, b.endpoint, b.p256dh, b.auth, b.preferred_station_id, b.min_alert_level ?? 'Ruim').run();
      return json({ id }, 201);
    }
    return json({ error: { code: 'NOT_FOUND', message: url.pathname } }, 404);
  },

  // Cron: hora cheia → varredura push 6-24h (transição p/ Ruim+); seg 06h → avaliações semanais
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // TODO H-III: query prediction_logs JOIN subscriptions, web-push via VAPID
    // TODO semanal: join observed×logs → weekly_evaluations (MAE, accuracy, FAR, MER, drift)
    console.log('cron', event.cron);
  },
};
