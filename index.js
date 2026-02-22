import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { InfluxDB, Point } from "@influxdata/influxdb-client";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const url = process.env.INFLUX_URL;
const token = process.env.INFLUX_TOKEN;
const org = process.env.INFLUX_ORG;
const bucket = process.env.INFLUX_BUCKET;

const influxDB = new InfluxDB({ url, token });
const queryApi = influxDB.getQueryApi(org);
const writeApi = influxDB.getWriteApi(org, bucket);

const PORT = process.env.PORT || 3000;

/* ===============================
   FUNZIONE NORMALIZZAZIONE FASCIA
================================ */
function determinaFascia(dateObj) {
  const hour = dateObj.getHours();

  if (hour >= 8 && hour < 11) return "09";
  if (hour >= 13 && hour < 16) return "14";
  if (hour >= 20 && hour < 23) return "21";

  return null;
}

/* ===============================
   ROOT
================================ */
app.get("/", (req, res) => {
  res.send("Backend Apiario attivo 🚀");
});

/* ===============================
   SCRITTURA DATI DAL LILYGO
================================ */
app.post("/api/peso", async (req, res) => {

  if (req.headers["x-api-key"] !== process.env.API_KEY) {
    return res.status(401).json({ error: "Non autorizzato" });
  }

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

    // Costruisco timestamp normalizzato (09:00 / 14:00 / 21:00)
    const dataNormalizzata = new Date(dataOriginale);
    dataNormalizzata.setHours(parseInt(fascia));
    dataNormalizzata.setMinutes(0);
    dataNormalizzata.setSeconds(0);
    dataNormalizzata.setMilliseconds(0);

    let melari = 1;
    let incremento = 0;

    // Se è fascia 21 calcolo incremento giornaliero
    if (fascia === "21") {

      const ieri = new Date(dataNormalizzata);
      ieri.setDate(ieri.getDate() - 1);

      const fluxQuery = `
        from(bucket: "${bucket}")
          |> range(start: -2d)
          |> filter(fn: (r) => r._measurement == "peso_arnia")
          |> filter(fn: (r) => r._field == "peso_kg")
          |> filter(fn: (r) => r.fascia == "21")
          |> filter(fn: (r) => r.arnia == "${arnia}")
          |> sort(columns: ["_time"], desc: true)
          |> limit(n:2)
      `;

      const rows = await queryApi.collectRows(fluxQuery);

      if (rows.length > 0) {
        const pesoIeri = rows[0]._value;
        incremento = Number(peso) - Number(pesoIeri);

        if (incremento > 10) {
          melari = rows[0].melari ? Number(rows[0].melari) + 1 : 2;
        } else {
          melari = rows[0].melari ? Number(rows[0].melari) : 1;
        }
      }
    }

    const point = new Point("peso_arnia")
      .tag("apiario", "automatico")
      .tag("arnia", String(arnia))
      .tag("fascia", fascia)
      .floatField("peso_kg", Number(peso))
      .floatField("lat", Number(lat))
      .floatField("lon", Number(lon))
      .floatField("incremento_kg", incremento)
      .intField("melari", melari)
      .timestamp(dataNormalizzata);

    writeApi.writePoint(point);
    await writeApi.flush();

    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ===============================
   STATO ARNI A (solo fascia 21)
================================ */
app.get("/api/stato", async (req, res) => {

  if (req.headers["x-api-key"] !== process.env.API_KEY) {
    return res.status(401).json({ error: "Non autorizzato" });
  }

  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -7d)
      |> filter(fn: (r) => r._measurement == "peso_arnia")
      |> filter(fn: (r) => r.fascia == "21")
      |> last()
      |> pivot(
          rowKey:["_time"],
          columnKey: ["_field"],
          valueColumn: "_value"
      )
  `;

  try {

    const rows = await queryApi.collectRows(fluxQuery);

    if (rows.length === 0) {
      return res.json({ message: "Nessun dato disponibile" });
    }

    const r = rows[0];

    res.json({
      arnia: r.arnia,
      peso_kg: r.peso_kg,
      incremento_kg: r.incremento_kg,
      melari: r.melari,
      lat: r.lat,
      lon: r.lon,
      time: r._time
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* =============================== */
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});