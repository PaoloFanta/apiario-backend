import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const {
  INFLUX_URL,
  INFLUX_TOKEN,
  INFLUX_ORG,
  INFLUX_BUCKET,
  API_KEY,
  PORT
} = process.env;

const influxDB = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const queryApi = influxDB.getQueryApi(INFLUX_ORG);
const writeApi = influxDB.getWriteApi(INFLUX_ORG, INFLUX_BUCKET);

const serverPort = PORT || 3000;

/* =========================================
   MIDDLEWARE AUTH
========================================= */
function checkApiKey(req, res, next) {
  if (req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ error: "Non autorizzato" });
  }
  next();
}

/* =========================================
   ROOT
========================================= */
app.get("/", (req, res) => {
  res.send("Backend Apiario attivo 🚀");
});

/* =========================================
   FUNZIONE FASCIA ORARIA
========================================= */
function determinaFascia(dateObj) {
  const hour = dateObj.getHours();
  if (hour >= 8 && hour < 11) return "09";
  if (hour >= 13 && hour < 16) return "14";
  if (hour >= 20 && hour < 23) return "21";
  return null;
}

/* =========================================
   POST /api/peso
========================================= */
app.post("/api/peso", checkApiKey, async (req, res) => {
  const { arnia, peso, lat, lon, timestamp } = req.body;

  if (!arnia || peso == null || lat == null || lon == null || !timestamp) {
    return res.status(400).json({ error: "Dati mancanti" });
  }

  try {
    const dataOriginale = new Date(timestamp);
    const fascia = determinaFascia(dataOriginale);

    if (!fascia) {
      return res.status(400).json({ error: "Orario fuori fascia valida" });
    }

    const dataNormalizzata = new Date(dataOriginale);
    dataNormalizzata.setHours(parseInt(fascia));
    dataNormalizzata.setMinutes(0, 0, 0);

    const point = new Point("peso_arnia")
      .tag("apiario", "automatico")
      .tag("arnia", String(arnia))
      .tag("fascia", fascia)
      .floatField("peso_kg", Number(peso))
      .floatField("lat", Number(lat))
      .floatField("lon", Number(lon))
      .timestamp(dataNormalizzata);

    writeApi.writePoint(point);
    await writeApi.flush();

    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* =========================================
   GET /api/stato
   Ultima fascia 21 per arnia specifica
========================================= */
app.get("/api/stato", checkApiKey, async (req, res) => {

  const arnia = String(req.query.arnia || "1");

  const fluxQuery = `
    from(bucket: "${INFLUX_BUCKET}")
      |> range(start: -10d)
      |> filter(fn: (r) => r._measurement == "peso_arnia")
      |> filter(fn: (r) => r.fascia == "21")
      |> filter(fn: (r) => r.arnia == "${arnia}")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n:1)
      |> pivot(
          rowKey:["_time"],
          columnKey: ["_field"],
          valueColumn: "_value"
      )
  `;

  try {
    const rows = await queryApi.collectRows(fluxQuery);

    if (rows.length === 0) {
      return res.json({});
    }

    const r = rows[0];

    res.json({
      arnia: r.arnia,
      peso_kg: r.peso_kg,
      lat: r.lat,
      lon: r.lon,
      time: r._time
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* =========================================
   GET /api/storico
========================================= */
app.get("/api/storico", checkApiKey, async (req, res) => {

  const arnia = String(req.query.arnia || "1");

  const fluxQuery = `
    from(bucket: "${INFLUX_BUCKET}")
      |> range(start: -10d)
      |> filter(fn: (r) => r._measurement == "peso_arnia")
      |> filter(fn: (r) => r.fascia == "21")
      |> filter(fn: (r) => r.arnia == "${arnia}")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n:10)
      |> pivot(
          rowKey:["_time"],
          columnKey: ["_field"],
          valueColumn: "_value"
      )
  `;

  try {
    const rows = await queryApi.collectRows(fluxQuery);

    const result = rows.map(r => ({
      arnia: r.arnia,
      peso_kg: r.peso_kg,
      lat: r.lat,
      lon: r.lon,
      time: r._time
    }));

    res.json(result);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ========================================= */
app.listen(serverPort, () => {
  console.log("Server running on port", serverPort);
});