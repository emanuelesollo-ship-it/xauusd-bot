import { useState, useEffect, useCallback, useRef } from "react";

const API = process.env.REACT_APP_API_URL || "http://localhost:3001";

function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return 50;
  const changes = candles.slice(-period - 1).map((c, i, arr) => i === 0 ? 0 : c.close - arr[i - 1].close).slice(1);
  const gains = changes.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
  const losses = Math.abs(changes.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;
  if (losses === 0) return 100;
  return +(100 - 100 / (1 + gains / losses)).toFixed(1);
}

function calcEMA(candles, period) {
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 1; i < candles.length; i++) ema = candles[i].close * k + ema * (1 - k);
  return +ema.toFixed(2);
}

function MiniChart({ candles }) {
  if (!candles || candles.length < 2) return null;
  const last24 = candles.slice(-24);
  const maxH = Math.max(...last24.map(c => c.high));
  const minL = Math.min(...last24.map(c => c.low));
  const range = maxH - minL || 1;
  const W = 320, H = 80, P = 4, bw = (W - P * 2) / last24.length;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {last24.map((c, i) => {
        const x = P + i * bw + bw * 0.1, bW = bw * 0.8;
        const yH = P + ((maxH - c.high) / range) * (H - P * 2);
        const yL = P + ((maxH - c.low) / range) * (H - P * 2);
        const yO = P + ((maxH - c.open) / range) * (H - P * 2);
        const yC = P + ((maxH - c.close) / range) * (H - P * 2);
        const col = c.close >= c.open ? "#22c55e" : "#ef4444";
        return (
          <g key={i}>
            <line x1={x + bW / 2} y1={yH} x2={x + bW / 2} y2={yL} stroke={col} strokeWidth={0.8} />
            <rect x={x} y={Math.min(yO, yC)} width={bW} height={Math.abs(yC - yO) || 1} fill={col} />
          </g>
        );
      })}
    </svg>
  );
}

export default function App() {
  const [candles, setCandles] = useState([]);
  const [livePrice, setLivePrice] = useState(null);
  const [prevPrice, setPrevPrice] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState(null);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const timerRef = useRef(null);

  const priceChange = livePrice && prevPrice ? +(livePrice - prevPrice).toFixed(2) : 0;
  const pricePct = prevPrice ? +((priceChange / prevPrice) * 100).toFixed(3) : 0;
  const pc = priceChange >= 0 ? "#4ade80" : "#ef4444";

  const fetchCandles = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/candles`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setCandles(data.candles);
      const last = data.candles[data.candles.length - 1];
      const prev = data.candles[data.candles.length - 2];
      setLivePrice(last.close);
      setPrevPrice(prev?.close || last.close);
      return data.candles;
    } catch (e) {
      setError("Candele: " + e.message);
      return null;
    }
  }, []);

  const fetchPrice = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/price`);
      const data = await r.json();
      if (data.price) {
        setPrevPrice(livePrice);
        setLivePrice(data.price);
      }
    } catch (_) {}
  }, [livePrice]);

  const runAnalysis = useCallback(async (c) => {
    if (!c || c.length < 5) return;
    setLoading(true);
    setError("");
    try {
      const rsi = calcRSI(c);
      const ema20 = calcEMA(c.slice(-20), 20);
      const ema50 = calcEMA(c.slice(-50), 50);
      const last = c[c.length - 1];
      const high = Math.max(...c.map(x => x.high));
      const low = Math.min(...c.map(x => x.low));
      const prompt = `XAU/USD DATI REALI — Prezzo: ${last.close} | O:${last.open} H:${last.high} L:${last.low} | EMA20:${ema20} EMA50:${ema50} | RSI:${rsi} | H:${high.toFixed(2)} L:${low.toFixed(2)} | Trend:${ema20 > ema50 ? "BULLISH" : "BEARISH"}`;
      const r = await fetch(`${API}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setAnalysis(data);
      setLastUpdate(new Date());
    } catch (e) {
      setError("AI: " + e.message);
    }
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    const c = await fetchCandles();
    if (c) runAnalysis(c);
  }, [fetchCandles, runAnalysis]);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(fetchPrice, 30000);
    return () => clearInterval(timerRef.current);
  }, []);

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const q = chatInput.trim();
    setChatInput("");
    setChatLoading(true);
    const ctx = analysis ? `[XAU/USD ${livePrice?.toFixed(2)}, ${analysis.signal}, RSI ${analysis.indicators?.rsi}] ` : "";
    const hist = [...chatHistory, { role: "user", content: ctx + q }];
    setChatHistory([...chatHistory, { role: "user", content: q }]);
    try {
      const r = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: hist }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setChatHistory(h => [...h, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setChatHistory(h => [...h, { role: "assistant", content: "Errore: " + e.message }]);
    }
    setChatLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:"#0c0a09", color:"#f5f5f4", fontFamily:"Inter,sans-serif", padding:"18px 14px", boxSizing:"border-box" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
            <span style={{ fontSize:18, fontWeight:800 }}>XAU/USD</span>
            <span style={{ background:"#292524", color:"#78716c", padding:"2px 7px", borderRadius:4, fontSize:10 }}>GOLD • 15M • LIVE</span>
          </div>
          <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
            <span style={{ fontSize:28, fontWeight:900 }}>{livePrice?.toFixed(2) ?? "---"}</span>
            {livePrice && <span style={{ fontSize:12, color:pc, fontWeight:600 }}>{priceChange>=0?"+":""}{priceChange} ({pricePct>=0?"+":""}{pricePct}%)</span>}
          </div>
        </div>
        <button onClick={refresh} disabled={loading} style={{ background:loading?"#292524":"#d97706", color:"#fff", border:"none", borderRadius:8, padding:"9px 14px", fontWeight:700, fontSize:12, cursor:loading?"not-allowed":"pointer" }}>
          {loading?"...":"⟳ Refresh"}
        </button>
      </div>

      <div style={{ background:"#1c1917", borderRadius:10, padding:"10px 8px", marginBottom:12 }}>
        <div style={{ fontSize:10, color:"#78716c", marginBottom:4 }}>Candele 15min — dati reali</div>
        <MiniChart candles={candles} />
      </div>

      {error && <div style={{ background:"#450a0a", color:"#f87171", borderRadius:8, padding:"8px 12px", marginBottom:12, fontSize:12 }}>{error}</div>}
      {loading && !analysis && <div style={{ textAlign:"center", color:"#78716c", padding:20 }}>Analisi AI in corso...</div>}

      {analysis && <>
        <div style={{ background:"#1c1917", borderRadius:10, padding:14, marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <span style={{ background:analysis.signal==="BUY"?"#14532d":analysis.signal==="SELL"?"#450a0a":"#292524", color:analysis.signal==="BUY"?"#4ade80":analysis.signal==="SELL"?"#f87171":"#a8a29e", padding:"3px 12px", borderRadius:6, fontWeight:800, fontSize:13 }}>
              {analysis.signal==="BUY"?"⬆ BUY":analysis.signal==="SELL"?"⬇ SELL":"◆ NEUTRAL"}
            </span>
            <span style={{ fontSize:10, color:"#57534e" }}>{lastUpdate?.toLocaleTimeString("it-IT")}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
            <span style={{ color:"#78716c" }}>Confidenza</span>
            <span style={{ color:analysis.confidence>=70?"#4ade80":"#facc15", fontWeight:700 }}>{analysis.confidence}%</span>
          </div>
          <div style={{ background:"#292524", borderRadius:3, height:4, marginBottom:10 }}>
            <div style={{ width:`${analysis.confidence}%`, background:analysis.confidence>=70?"#4ade80":"#facc15", height:4, borderRadius:3 }} />
          </div>
          <div style={{ fontSize:12, color:"#d6d3d1", lineHeight:1.6 }}>{analysis.summary}</div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
          <div style={{ background:"#1c1917", borderRadius:10, padding:12 }}>
            <div style={{ fontSize:10, color:"#78716c", marginBottom:7 }}>OPERATIVI</div>
            {[["Entry",analysis.entry,"#facc15"],["SL",analysis.stopLoss,"#f87171"],["TP1",analysis.takeProfit1,"#4ade80"],["TP2",analysis.takeProfit2,"#86efac"]].map(([l,v,c])=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                <span style={{ color:"#78716c" }}>{l}</span><span style={{ color:c, fontWeight:700 }}>{v?.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{ background:"#1c1917", borderRadius:10, padding:12 }}>
            <div style={{ fontSize:10, color:"#78716c", marginBottom:7 }}>SUP / RES</div>
            {[["R2",analysis.keyLevels?.resistance2,"#f87171"],["R1",analysis.keyLevels?.resistance1,"#fca5a5"],["S1",analysis.keyLevels?.support1,"#86efac"],["S2",analysis.keyLevels?.support2,"#4ade80"]].map(([l,v,c])=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                <span style={{ color:"#78716c" }}>{l}</span><span style={{ color:c, fontWeight:700 }}>{v?.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background:"#1c1917", borderRadius:10, padding:12, marginBottom:10 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", textAlign:"center" }}>
            <div>
              <div style={{ fontSize:18, fontWeight:800, color:analysis.indicators?.rsi>70?"#f87171":analysis.indicators?.rsi<30?"#4ade80":"#facc15" }}>{analysis.indicators?.rsi}</div>
              <div style={{ fontSize:10, color:"#78716c" }}>RSI(14)</div>
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:800, color:analysis.indicators?.maSignal==="BUY"?"#4ade80":"#f87171" }}>{analysis.indicators?.maSignal}</div>
              <div style={{ fontSize:10, color:"#78716c" }}>EMA Cross</div>
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:800, color:analysis.indicators?.momentum==="STRONG"?"#4ade80":"#facc15" }}>{analysis.indicators?.momentum}</div>
              <div style={{ fontSize:10, color:"#78716c" }}>Momentum</div>
            </div>
          </div>
        </div>
      </>}

      <div style={{ background:"#1c1917", borderRadius:10, padding:12 }}>
        <div style={{ fontSize:10, color:"#78716c", marginBottom:8 }}>💬 CHIEDI ALL'AI</div>
        <div style={{ maxHeight:150, overflowY:"auto", marginBottom:8, display:"flex", flexDirection:"column", gap:6 }}>
          {!chatHistory.length && <div style={{ color:"#57534e", fontSize:11, textAlign:"center", padding:8 }}>Es: "Conviene entrare long?"</div>}
          {chatHistory.map((m,i)=>(
            <div key={i} style={{ background:m.role==="user"?"#292524":"#0c0a09", borderRadius:7, padding:"7px 10px", fontSize:11, color:m.role==="user"?"#f5f5f4":"#d6d3d1", alignSelf:m.role==="user"?"flex-end":"flex-start", maxWidth:"90%" }}>
              {m.content}
            </div>
          ))}
          {chatLoading && <div style={{ color:"#78716c", fontSize:11 }}>Scrittura...</div>}
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Fai una domanda..."
            style={{ flex:1, background:"#0c0a09", border:"1px solid #292524", borderRadius:7, padding:"8px 10px", color:"#f5f5f4", fontSize:11, outline:"none" }} />
          <button onClick={sendChat} disabled={chatLoading||!chatInput.trim()} style={{ background:"#d97706", color:"#fff", border:"none", borderRadius:7, padding:"8px 12px", fontWeight:700, cursor:"pointer" }}>→</button>
        </div>
      </div>

      <div style={{ textAlign:"center", color:"#44403c", fontSize:9, marginTop:12 }}>⚠ Solo scopo educativo. Non è consulenza finanziaria.</div>
    </div>
  );
}
