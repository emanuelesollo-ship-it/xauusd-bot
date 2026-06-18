require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

// Offset per convertire GC=F futures in spot XAU/USD
const FUTURES_SPOT_OFFSET = -38;

app.get("/api/candles", async (req, res) => {
  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=15m&range=2d";
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(400).json({ error: "Nessun dato Yahoo" });
    const timestamps = result.timestamp;
    const ohlcv = result.indicators.quote[0];
    const candles = timestamps.map((t, i) => ({
      time: new Date(t * 1000).toISOString(),
      open:  ohlcv.open[i]  ? +(ohlcv.open[i]  + FUTURES_SPOT_OFFSET).toFixed(2) : null,
      high:  ohlcv.high[i]  ? +(ohlcv.high[i]  + FUTURES_SPOT_OFFSET).toFixed(2) : null,
      low:   ohlcv.low[i]   ? +(ohlcv.low[i]   + FUTURES_SPOT_OFFSET).toFixed(2) : null,
      close: ohlcv.close[i] ? +(ohlcv.close[i] + FUTURES_SPOT_OFFSET).toFixed(2) : null,
    })).filter(c => c.open && c.high && c.low && c.close).slice(-52);
    res.json({ candles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/price", async (req, res) => {
  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1m&range=1d";
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(400).json({ error: "Nessun dato" });
    const closes = result.indicators.quote[0].close.filter(Boolean);
    const price = closes[closes.length - 1] + FUTURES_SPOT_OFFSET;
    res.json({ price: +price.toFixed(2) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { prompt } = req.body;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: `Sei un analista tecnico esperto specializzato in XAU/USD. Rispondi SOLO con JSON valido, nessun testo extra. Struttura: {"signal":"BUY","confidence":72,"entry":3318.50,"stopLoss":3305.00,"takeProfit1":3335.00,"takeProfit2":3352.00,"trend":"BULLISH","summary":"Analisi in italiano max 2 frasi.","keyLevels":{"support1":3305,"support2":3290,"resistance1":3335,"resistance2":3352},"indicators":{"rsi":58,"maSignal":"BUY","momentum":"MODERATE"}}`,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(400).json({ error: data.error?.message });
    const text = data.content?.map(b => b.text || "").join("").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: "Risposta AI non valida" });
    res.json(JSON.parse(match[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: "Sei un esperto trader XAU/USD. Rispondi in italiano, conciso e pratico.",
        messages,
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(400).json({ error: data.error?.message });
    const reply = data.content?.map(b => b.text || "").join("").trim();
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
