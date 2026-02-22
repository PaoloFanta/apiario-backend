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
   ROOT
================================ */
app.get("/", (req, res) => {
  res.send("Backend Apiario attivo 🚀");
});

/* ===============================
   SCRITTURA DATI BILANCIA
================================ */
app.post("/api/peso", async (req, res) => {

  if (req.headers["x-api-key"] !== process.env.API_KEY) {
    return res.status(401).json({ error: "Non autorizzato" });
  }

  const { arnia, peso, lat, lon } = req.body;

  if (!arnia || peso == null || lat == null || lon == null) {
    return res.status(400).json({ error: "Dati mancanti" });
  }

  try {

    const point = new Point("peso_arnia")
      .tag("apiario", "automatico")
      .tag("arnia", String(arnia))
      .floatField("peso_kg", Number(peso))
      .floatField("lat", Number(lat))
      .floatField("lon", Number(lon));

    writeApi.writePoint(point);
    await writeApi.flush();

    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ===============================
   LETTURA ULTIMA MISURAZIONE
================================ */
app.get("/api/ultima", async (req, res) => {

  if (req.headers["x-api-key"] !== process.env.API_KEY) {
    return res.status(401).json({ error: "Non autorizzato" });
  }

  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -7d)
      |> filter(fn: (r) => r._measurement == "peso_arnia")
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
      return res.json({ message: "Nessun dato trovato" });
    }

    const r = rows[0];

    const result = {
      arnia: r.arnia,
      apiario: r.apiario,
      peso_kg: r.peso_kg,
      lat: r.lat,
      lon: r.lon,
      time: r._time
    };

    res.json(result);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ===============================
   AVVIO SERVER
================================ */
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});