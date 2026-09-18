// workers/ingestion/src/index.ts — Cron :30 ingestão RAMQAr/OpenAQ/Open-Meteo/INMET/tráfego/satélite
export interface Env { DB: D1Database; }

async function ingest(env: Env) {
  // TODO H-II: fetch RAMQAr/IEMA (ground truth) → observed_pollutants (upsert station×timestamp)
  // TODO H-II: fetch Open-Meteo forecast 48h + INMET → environmental_features (is_forecast=1)
  // TODO H-III: tráfego CETURB/TomTom (congestion por ponte) + MODIS AOD + TROPOMI NO2
  console.log('ingest tick');
}

export default {
  async fetch() { return new Response('ingestion worker — ver specs/08', { status: 200 }); },
  async scheduled(_e: ScheduledEvent, env: Env) { await ingest(env); },
};
