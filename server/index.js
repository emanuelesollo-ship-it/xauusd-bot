require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const TWELVE_KEY = process.env.TWELVE_DATA_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

// Genera candele realistiche basate sul prezzo live reale
function generateCandles(basePrice, count = 52) {
  const candles = [];
  let price = basePrice;
  const now = Date.now();
  for (let i = count - 1; i >= 0; i--) {
    const change = (Math.random() - 0.49) * 12;
    const open = +price.toFixed(2);
    const close = +(price + change).toFixed(2);
    const high = +(Math.max(open, close) + Math.random() * 5).toFixed(2);
    const low = +(Math.min(open, close) - Math.random() * 5).toFixed(2);
    const time = new Date(now - i * 15 * 60 * 1000).toISOString();
    candles.push({ time, open, high, low, close });
    price = close;
  }
  return candles;
}

app.get("/api/price", async (req, res) => {
  try {
    const url = `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TWELVE_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.status === "error") return res.status(400).json({ error: data.message });
    res.json({ price: parseFloat(data.price) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/candles", async (req, res) => {
  try {
    // Prima prende il prezzo reale
    const url = `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TWELVE_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    const basePrice = data.price ? parseFloat(data.price) : 4300;
    // Genera candele realistiche attorno al prezzo reale
    const candles = generateCandles(basePrice);
    res.json({ candles });
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
