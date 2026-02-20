import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { InfluxDB } from "@influxdata/influxdb-client";

dotenv.config();

const app = express();
app.use(cors());

const url = process.env.INFLUX_URL;
const token = process.env.INFLUX_TOKEN;
const org = process.env.INFLUX_ORG;
const bucket = process.env.INFLUX_BUCKET;

const influxDB = new InfluxDB({ url, token });
const queryApi = influxDB.getQueryApi(org);

app.get("/", (req, res) => {
  res.send("Backend Apiario attivo 🚀");
});

app.get("/api/ultima", async (req, res) => {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -7d)
      |> filter(fn: (r) => r._measurement == "peso_arnia")
      |> last()
  `;

  let result = [];

  try {
    await queryApi.collectRows(fluxQuery).then((rows) => {
      result = rows;
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});