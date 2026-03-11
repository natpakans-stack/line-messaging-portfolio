/****************************************************
 * EPL LINE Notifier (2025/26) — DUAL BOTS + ROAST
 * 1. น้องกริ่ง -> กลุ่มเดิม
 * 2. Cody -> กลุ่ม Scousers
 *
 * ทุกเช้า 08:00 → ส่งผลบอล + ตาราง + ดาวซัลโว
 *                  ถ้าลิเวอร์พูลเตะ → roast ต่อท้าย
 * ทุกศุกร์ 19:00 → ส่งโปรแกรมสัปดาห์
 ****************************************************/

/* =========================
 * 0) CONFIG
 * ========================= */
const TIMEZONE = "Asia/Bangkok";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const FD_BASE = "https://football-proxy.tan-natpakan.workers.dev/v4";
const FD_COMP = "PL";
const EPL_SEASON_START_YEAR = 2025;

// UI Assets
const PL_PURPLE = "#37003C";
const PL_LOGO_URL = "https://res.cloudinary.com/din3e669q/image/upload/v1768160149/Premier-League-Logo_yd26fw.png";

// Limits
const RESULTS_MAX_TOTAL = 10;
const NEXT_MAX_TOTAL = 10;
const STANDINGS_SHOW_TOP = 10;
const SCORERS_LIMIT = 10;

// Liverpool Roast Config (ส่งทั้ง 2 กลุ่ม)
const LIV_TEAM_ID = 64;

const SPECIAL_RAGE = {
  "Manchester United": 10,
  "Everton": 20
};

const SPECIAL_FLEX = [
  "Manchester City",
  "Arsenal"
];

// Mock/Tease Config — แซวทีมเหล่านี้ ส่งเฉพาะน้องกริ่ง
const MOCK_TEAMS = [
  { id: 61, name: "Chelsea" },
  { id: 66, name: "Manchester United" }
];

/* ============================================================
 * 1) LINE PUSH
 * ============================================================ */

/** ส่งเฉพาะบอทที่ระบุ (ใช้สำหรับแซวเชลซี/แมนยู → น้องกริ่งเท่านั้น) */
function linePushTo_(messages, token, to, botName) {
  if (!token || !to) {
    Logger.log("Skip " + botName + ": Missing Token or Group ID");
    return;
  }
  try {
    const res = UrlFetchApp.fetch(LINE_PUSH_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify({ to: to, messages }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 200) {
      Logger.log("[" + botName + "] Sent successfully.");
    } else {
      Logger.log("[" + botName + "] Failed: " + res.getContentText());
    }
  } catch (e) {
    Logger.log("[" + botName + "] Error: " + e.message);
  }
}

/** ส่งทั้ง 2 บอท (ผลบอล + roast ลิเวอร์พูล) */
function linePush_(messages) {
  const targets = [
    {
      name: "น้องกริ่ง",
      token: getProp_("LINE_ACCESS_TOKEN"),
      to:    getProp_("LINE_TO")
    },
    {
      name: "Cody",
      token: getProp_("LINE_ACCESS_TOKEN_CODY"),
      to:    getProp_("LINE_TO_SCOUSERS")
    }
  ];

  targets.forEach(t => {
    if (!t.token || !t.to) {
      Logger.log("Skip " + t.name + ": Missing Token or Group ID");
      return;
    }

    try {
      const res = UrlFetchApp.fetch(LINE_PUSH_URL, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + t.token },
        payload: JSON.stringify({ to: t.to, messages }),
        muteHttpExceptions: true
      });

      const code = res.getResponseCode();
      if (code === 200) {
        Logger.log("[" + t.name + "] Sent successfully.");
      } else {
        Logger.log("[" + t.name + "] Failed: " + res.getContentText());
      }
    } catch (e) {
      Logger.log("[" + t.name + "] Error: " + e.message);
    }
  });
}

/* =========================
 * 2) HELPERS
 * ========================= */
function safeText_(v, fallback) {
  const fb = (fallback === undefined || fallback === null) ? "-" : String(fallback);
  if (v === null || v === undefined) return fb;
  const s = String(v).trim();
  return s ? s : fb;
}

function getProp_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function setProp_(k, v) { return PropertiesService.getScriptProperties().setProperty(k, v); }

function safeJsonParse_(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

function addDays_(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}
function startOfDay_(d) {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}
function fmtDate_(d) { return Utilities.formatDate(d, TIMEZONE, "yyyy-MM-dd"); }
function fmtDayTHShort_(isoUtc) { return Utilities.formatDate(new Date(isoUtc), TIMEZONE, "EEE d MMM"); }

function toLocal_(d) {
  return new Date(Utilities.formatDate(d, TIMEZONE, "yyyy/MM/dd HH:mm:ss"));
}
function isBetween_(dt, start, end) {
  const t = dt.getTime();
  return t >= start.getTime() && t < end.getTime();
}

/* =========================
 * 3) FOOTBALL API & CACHE
 * ========================= */
function fdRateLimit_() {
  const now = Date.now();
  const lastRaw = getProp_("FD_LAST_CALL_MS");
  const last = lastRaw ? Number(lastRaw) : 0;
  const wait = 6500 - (now - last);
  if (wait > 0) Utilities.sleep(wait);
  setProp_("FD_LAST_CALL_MS", String(Date.now()));
}

function fdFetchJson_(path, params) {
  fdRateLimit_();
  let url = FD_BASE + path;
  if (params && Object.keys(params).length) {
    const qs = Object.keys(params).map(k => k + "=" + params[k]).join("&");
    url += "?" + qs;
  }
  const res = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true });
  return JSON.parse(res.getContentText());
}

function cachedFetch_(cacheKey, fetchFn) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);
  const data = fetchFn();
  cache.put(cacheKey, JSON.stringify(data), 600);
  return data;
}

/* =========================
 * 4) TEAM ASSETS
 * ========================= */
function ensureTeamAssetsMap_() {
  const raw = getProp_("PL_TEAM_ASSETS_MAP");
  if (raw) {
    const obj = safeJsonParse_(raw, null);
    if (obj && obj._meta && new Date(obj._meta.expiresAt) > new Date()) return obj.map || {};
  }
  const data = fdFetchJson_("/competitions/" + FD_COMP + "/teams", { season: EPL_SEASON_START_YEAR });
  const map = {};
  (data.teams || []).forEach(t => {
    map[String(t.id)] = { id: t.id, shortName: t.shortName || t.name, crest: t.crest };
  });
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  setProp_("PL_TEAM_ASSETS_MAP", JSON.stringify({ _meta: { expiresAt }, map }));
  return map;
}

function crestByTeamId_(assets, id) { return assets[String(id)]?.crest || null; }
function shortTeamById_(assets, id, fallback) { return assets[String(id)]?.shortName || safeText_(fallback, "-"); }

/* =========================
 * 5) DATA FETCHERS
 * ========================= */
function getEplStandings_() {
  return cachedFetch_("PL_standings_" + EPL_SEASON_START_YEAR, () =>
    fdFetchJson_("/competitions/" + FD_COMP + "/standings", { season: EPL_SEASON_START_YEAR })
  );
}

function getEplScorers_() {
  return cachedFetch_("PL_scorers_" + EPL_SEASON_START_YEAR, () =>
    fdFetchJson_("/competitions/" + FD_COMP + "/scorers", { season: EPL_SEASON_START_YEAR, limit: SCORERS_LIMIT })
  );
}

function getCompetitionMatches_(dateFrom, dateTo, status) {
  return cachedFetch_("PL_matches_" + dateFrom + "_" + dateTo + "_" + (status || "ALL"), () => {
    const params = { season: EPL_SEASON_START_YEAR, dateFrom, dateTo };
    if (status) params.status = status;
    const data = fdFetchJson_("/competitions/" + FD_COMP + "/matches", params);
    return data.matches || [];
  });
}

/* =========================
 * 6) LIVERPOOL ROAST ENGINE
 * ========================= */

/** หา Liverpool match จาก array ของ matches ที่เตะจบแล้ว */
function findLiverpoolMatch_(matches) {
  return matches.find(m =>
    m.homeTeam.id == LIV_TEAM_ID || m.awayTeam.id == LIV_TEAM_ID
  ) || null;
}

/** หาอันดับจากตาราง standings ที่โหลดมาแล้ว */
function getRanksFromStandings_(standings, opponentId) {
  const table = standings.standings[0].table;
  let rank = 99;
  let oppRank = 99;

  table.forEach(t => {
    if (t.team.id == LIV_TEAM_ID) rank = t.position;
    if (t.team.id == opponentId) oppRank = t.position;
  });

  return { rank, oppRank };
}

/** สร้าง context สำหรับ GPT prompt */
function buildRoastContext_(mood, opponent, rank, oppRank) {
  let rage = 1;
  let text = "";

  if (mood == "WIN") {
    text = "โม้แบบแฟนบอลลิเวอร์พูลมั่นหน้า";
    if (SPECIAL_FLEX.includes(opponent)) {
      text += " ชนะทีมใหญ่ ต้องโม้ทั้งวัน";
    }
  }

  if (mood == "DRAW") {
    text = "ประชดแบบแฟนบอลเซ็งๆ";
  }

  if (mood == "LOSS") {
    text = "ด่า Arne Slot แบบแฟนบอลหัวร้อน";
    rage = 3;

    if (SPECIAL_RAGE[opponent]) {
      rage = SPECIAL_RAGE[opponent];
      text += " ดาร์บี้แมตช์ แฟนบอลเดือด";
    }
    if (oppRank > 15) {
      rage += 5;
      text += " แพ้ทีมท้ายตาราง";
    }
    if (rank > 4) {
      rage += 2;
      text += " อันดับตารางน่าอาย";
    }
  }

  return { rage, text };
}

/* =========================
 * 6.1) GPT USAGE TRACKER
 * ========================= */

// gpt-4.1-mini pricing (USD per 1M tokens)
const GPT_PRICE_INPUT  = 0.40;
const GPT_PRICE_OUTPUT = 1.60;

/** บันทึก token usage หลังเรียก GPT */
function trackUsage_(usage, label) {
  if (!usage) return;

  const raw = getProp_("GPT_USAGE_LOG") || "{}";
  const log = safeJsonParse_(raw, {});

  const month = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM");

  if (!log[month]) log[month] = { calls: 0, promptTokens: 0, completionTokens: 0 };

  log[month].calls += 1;
  log[month].promptTokens += (usage.prompt_tokens || 0);
  log[month].completionTokens += (usage.completion_tokens || 0);

  setProp_("GPT_USAGE_LOG", JSON.stringify(log));
  Logger.log("[Usage] " + label + ": " + (usage.prompt_tokens || 0) + " in / " + (usage.completion_tokens || 0) + " out");
}

/** สรุปยอดใช้ GPT → เขียน Google Sheet + ส่ง Email */
function sendUsageReport_() {
  const raw = getProp_("GPT_USAGE_LOG") || "{}";
  const log = safeJsonParse_(raw, {});

  const months = Object.keys(log).sort();
  if (!months.length) {
    Logger.log("No usage data.");
    return;
  }

  // --- 1) เขียน Google Sheet ---
  const ss = getOrCreateUsageSheet_();
  const sheet = ss.getSheetByName("Usage") || ss.insertSheet("Usage");

  // เขียน header ถ้ายังว่าง
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Month", "Calls", "Input Tokens", "Output Tokens", "Cost (USD)", "Cost (THB)", "Updated"]);
    sheet.getRange(1, 1, 1, 7).setFontWeight("bold");
  }

  let totalCalls = 0;
  let totalIn = 0;
  let totalOut = 0;

  months.forEach(m => {
    const d = log[m];
    const cost = (d.promptTokens / 1000000) * GPT_PRICE_INPUT + (d.completionTokens / 1000000) * GPT_PRICE_OUTPUT;
    const costTHB = cost * 34;

    // หาแถวของเดือนนี้ ถ้ามีแล้วก็ update ถ้าไม่มีก็ append
    const existing = findRowByMonth_(sheet, m);
    const rowData = [m, d.calls, d.promptTokens, d.completionTokens, +cost.toFixed(4), +costTHB.toFixed(2), new Date()];

    if (existing > 0) {
      sheet.getRange(existing, 1, 1, 7).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }

    totalCalls += d.calls;
    totalIn += d.promptTokens;
    totalOut += d.completionTokens;
  });

  const grandCost = (totalIn / 1000000) * GPT_PRICE_INPUT + (totalOut / 1000000) * GPT_PRICE_OUTPUT;

  // --- 2) ส่ง Email ---
  const email = Session.getActiveUser().getEmail();
  const subject = "EPL Bot — GPT Usage Report (" + Utilities.formatDate(new Date(), TIMEZONE, "MMM yyyy") + ")";

  const body = "GPT API Usage Report\n"
    + "Model: gpt-4.1-mini\n"
    + "Budget: $120/month\n"
    + "========================\n\n"
    + months.map(m => {
        const d = log[m];
        const cost = (d.promptTokens / 1000000) * GPT_PRICE_INPUT + (d.completionTokens / 1000000) * GPT_PRICE_OUTPUT;
        return m + "\n"
          + "  Calls: " + d.calls + "\n"
          + "  Input: " + d.promptTokens.toLocaleString() + " tokens\n"
          + "  Output: " + d.completionTokens.toLocaleString() + " tokens\n"
          + "  Cost: $" + cost.toFixed(4);
      }).join("\n\n")
    + "\n\n========================\n"
    + "Total: " + totalCalls + " calls\n"
    + "Total tokens: " + (totalIn + totalOut).toLocaleString() + "\n"
    + "Total cost: $" + grandCost.toFixed(4) + " (~" + (grandCost * 34).toFixed(2) + " THB)\n"
    + "Budget used: " + (grandCost / 120 * 100).toFixed(2) + "%\n\n"
    + "Sheet: " + ss.getUrl();

  GmailApp.sendEmail(email, subject, body);
  Logger.log("Usage report sent to " + email + " + Sheet updated.");
}

/** หา/สร้าง Google Sheet สำหรับ usage */
function getOrCreateUsageSheet_() {
  const sheetId = getProp_("USAGE_SHEET_ID");
  if (sheetId) {
    try { return SpreadsheetApp.openById(sheetId); } catch (e) { /* ถูกลบ → สร้างใหม่ */ }
  }
  const ss = SpreadsheetApp.create("EPL Bot — GPT Usage Log");
  setProp_("USAGE_SHEET_ID", ss.getId());
  return ss;
}

/** หาแถวของเดือนที่ระบุใน sheet (return row number หรือ -1) */
function findRowByMonth_(sheet, month) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === month) return i + 2;
  }
  return -1;
}

/** หาแมตช์ของทีมที่ต้องการแซว */
function findTeamMatch_(matches, teamId) {
  return matches.find(m =>
    m.homeTeam.id == teamId || m.awayTeam.id == teamId
  ) || null;
}

/** เรียก GPT แซวเชลซี/แมนยู */
function generateMockRoast_(match, teamName) {
  const apiKey = getProp_("OPENAI_KEY");
  if (!apiKey) return null;

  const isHome = match.homeTeam.name.includes(teamName);
  const teamScore = isHome ? match.score.fullTime.home : match.score.fullTime.away;
  const oppScore = isHome ? match.score.fullTime.away : match.score.fullTime.home;
  const opponent = isHome ? match.awayTeam.name : match.homeTeam.name;

  let result = "เสมอ";
  if (teamScore > oppScore) result = "ชนะ";
  if (teamScore < oppScore) result = "แพ้";

  const prompt = "คุณคือแฟนบอลที่ชอบแซว " + teamName + "\n\n"
    + "ผลบอล\n" + match.homeTeam.name + " " + match.score.fullTime.home + "-" + match.score.fullTime.away + " " + match.awayTeam.name + "\n\n"
    + teamName + " " + result + "\n\n"
    + "กติกา\n"
    + "- 1 ประโยค\n"
    + "- ภาษาแฟนบอลไทย\n"
    + "- ตลก กวน แซว ประชด\n"
    + "- ไม่เกิน 16 คำ\n"
    + "- ถ้าชนะก็หาทางแซวให้ได้ เช่น ชนะทีมเล็กมีอะไรจะโม้\n"
    + "- ถ้าแพ้หรือเสมอแซวเต็มที่\n";

  const res = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
    method: "post",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 1.1
    }),
    muteHttpExceptions: true
  });

  const data = JSON.parse(res.getContentText());
  trackUsage_(data.usage, "mock-" + teamName);
  return data.choices[0].message.content;
}

/** เรียก GPT สร้างข้อความ roast */
function generateRoast_(ctx) {
  const apiKey = getProp_("OPENAI_KEY");
  if (!apiKey) {
    Logger.log("Skip roast: No OPENAI_KEY");
    return null;
  }

  const prompt = "คุณคือแฟนบอล Liverpool สายหัวร้อนในผับ\n\n"
    + "ผลบอล\n" + ctx.home + " " + ctx.hs + "-" + ctx.as + " " + ctx.away + "\n\n"
    + "คู่แข่ง\n" + ctx.opponent + "\n\n"
    + "อันดับลิเวอร์พูล\n" + ctx.rank + "\n\n"
    + "สถานการณ์\n" + ctx.rageContext.text + "\n\n"
    + "ระดับความเดือด\n" + ctx.rageContext.rage + "/10\n\n"
    + "กติกา\n"
    + "- 1 ประโยค\n"
    + "- ภาษาแฟนบอล\n"
    + "- ตลก กวน\n"
    + "- ไม่เกิน 16 คำ\n\n"
    + "ถ้าแพ้\nด่า Arne Slot\n\n"
    + "ถ้าชนะ\nโม้แบบแฟนหงส์\n\n"
    + "ห้ามใช้คำว่า Anfield เป็นกริยา";

  const res = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
    method: "post",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 1.1
    }),
    muteHttpExceptions: true
  });

  const data = JSON.parse(res.getContentText());
  trackUsage_(data.usage, "roast-Liverpool");
  return data.choices[0].message.content;
}

/* =========================
 * 7) MAIN SENDERS
 * ========================= */

/** ทุกเช้า 08:00 → ผลบอล + ตาราง + ดาวซัลโว + roast ลิเวอร์พูล */
function sendMorningWrap_() {
  const assets = ensureTeamAssetsMap_();
  const now = new Date();
  const nowLocal = toLocal_(now);
  const todayLocalStart = new Date(nowLocal.getTime());
  todayLocalStart.setHours(0, 0, 0, 0);
  const yesterdayLocalStart = new Date(todayLocalStart.getTime());
  yesterdayLocalStart.setDate(yesterdayLocalStart.getDate() - 1);

  const fetchFrom = fmtDate_(addDays_(new Date(), -1));
  const fetchTo = fmtDate_(new Date());

  const matches = getCompetitionMatches_(fetchFrom, fetchTo, "FINISHED")
    .filter(m => isBetween_(toLocal_(new Date(m.utcDate)), yesterdayLocalStart, nowLocal));

  if (!matches.length) return;

  const standings = getEplStandings_();
  const scorers = getEplScorers_();

  // สร้าง messages: ผลบอล carousel
  const messages = [
    { type: "text", text: "สรุปผลบอลพรีเมียร์ลีกเมื่อคืน (" + fmtDate_(yesterdayLocalStart) + ")" },
    {
      type: "flex",
      altText: "Premier League Morning Wrap",
      contents: {
        type: "carousel",
        contents: [
          resultsBubble_(fmtDate_(yesterdayLocalStart), matches, assets),
          standingsBubble_(assets, standings),
          scorersBubble_(scorers)
        ]
      }
    }
  ];

  // ถ้าลิเวอร์พูลเตะ → เพิ่ม roast
  const livMatch = findLiverpoolMatch_(matches);
  if (livMatch) {
    const isHome = livMatch.homeTeam.id == LIV_TEAM_ID;
    const livScore = isHome ? livMatch.score.fullTime.home : livMatch.score.fullTime.away;
    const oppScore = isHome ? livMatch.score.fullTime.away : livMatch.score.fullTime.home;
    const opponent = isHome ? livMatch.awayTeam.name : livMatch.homeTeam.name;
    const opponentId = isHome ? livMatch.awayTeam.id : livMatch.homeTeam.id;

    let mood = "DRAW";
    if (livScore > oppScore) mood = "WIN";
    if (livScore < oppScore) mood = "LOSS";

    const ranks = getRanksFromStandings_(standings, opponentId);
    const rageContext = buildRoastContext_(mood, opponent, ranks.rank, ranks.oppRank);

    const roast = generateRoast_({
      home: livMatch.homeTeam.name,
      away: livMatch.awayTeam.name,
      hs: livMatch.score.fullTime.home,
      as: livMatch.score.fullTime.away,
      mood,
      opponent,
      rank: ranks.rank,
      oppRank: ranks.oppRank,
      rageContext
    });

    if (roast) {
      messages.push({ type: "text", text: roast });
    }
  }

  linePush_(messages);

  // แซวเชลซี/แมนยู → ส่งเฉพาะน้องกริ่ง
  const mockMessages = [];
  MOCK_TEAMS.forEach(team => {
    const mockMatch = findTeamMatch_(matches, team.id);
    if (!mockMatch) return;
    const mockText = generateMockRoast_(mockMatch, team.name);
    if (mockText) mockMessages.push({ type: "text", text: mockText });
  });

  if (mockMessages.length) {
    linePushTo_(
      mockMessages,
      getProp_("LINE_ACCESS_TOKEN"),
      getProp_("LINE_TO"),
      "น้องกริ่ง (mock)"
    );
  }
}

/** ทุกศุกร์ 19:00 → โปรแกรมสัปดาห์ */
function sendWeeklyPreview_() {
  const assets = ensureTeamAssetsMap_();
  const today = startOfDay_(new Date());
  const from = fmtDate_(today);
  const to = fmtDate_(addDays_(today, 6));

  const next = getCompetitionMatches_(from, to, null)
    .filter(m => m.status === "SCHEDULED" || m.status === "TIMED");

  if (!next.length) return;

  linePush_([
    { type: "text", text: "โปรแกรมพรีเมียร์ลีกสัปดาห์นี้ (" + from + " ถึง " + to + ")" },
    {
      type: "flex",
      altText: "Premier League Weekly Preview",
      contents: { type: "carousel", contents: [nextMatchesBubble_(from + " - " + to, next, assets)] }
    }
  ]);
}

/* =========================
 * 8) FLEX UI COMPONENTS
 * ========================= */
function teamCol_(crestUrl, teamName, align) {
  return {
    type: "box", layout: "vertical", spacing: "xs", flex: 4,
    contents: [
      crestUrl
        ? { type: "image", url: crestUrl, size: "xxs", aspectMode: "fit", align: align }
        : { type: "filler" },
      { type: "text", text: teamName, size: "sm", weight: "bold", color: "#111111", align: align }
    ]
  };
}

function centerPill_(main, sub, isPurple) {
  return {
    type: "box", layout: "vertical", flex: 2,
    contents: [
      {
        type: "box", layout: "vertical", paddingAll: "sm", cornerRadius: "lg",
        backgroundColor: isPurple ? PL_PURPLE : "#F1F1F1",
        contents: [{ type: "text", text: main, size: "sm", weight: "bold", color: isPurple ? "#FFFFFF" : "#111111", align: "center" }]
      },
      { type: "text", text: sub, size: "xs", color: "#888888", align: "center" }
    ]
  };
}

function resultsBubble_(date, matches, assets) {
  const blocks = [
    { type: "text", text: "ผลบอลเมื่อคืน", size: "lg", weight: "bold", align: "center" },
    { type: "separator", margin: "md" }
  ];
  matches.forEach(m => {
    blocks.push({
      type: "box", layout: "horizontal", spacing: "md", paddingTop: "8px",
      contents: [
        teamCol_(crestByTeamId_(assets, m.homeTeam.id), shortTeamById_(assets, m.homeTeam.id, m.homeTeam.name), "start"),
        centerPill_(m.score.fullTime.home + "-" + m.score.fullTime.away, "FT", true),
        teamCol_(crestByTeamId_(assets, m.awayTeam.id), shortTeamById_(assets, m.awayTeam.id, m.awayTeam.name), "end")
      ]
    });
  });
  return { type: "bubble", body: { type: "box", layout: "vertical", contents: blocks } };
}

function nextMatchesBubble_(label, matches, assets) {
  const blocks = [
    { type: "text", text: "โปรแกรมถัดไป", size: "lg", weight: "bold", align: "center" },
    { type: "separator", margin: "md" }
  ];
  matches.slice(0, 10).forEach(m => {
    const time = Utilities.formatDate(new Date(m.utcDate), TIMEZONE, "HH:mm");
    blocks.push({
      type: "box", layout: "horizontal", spacing: "md", paddingTop: "8px",
      contents: [
        teamCol_(crestByTeamId_(assets, m.homeTeam.id), shortTeamById_(assets, m.homeTeam.id, m.homeTeam.name), "start"),
        centerPill_(time, fmtDayTHShort_(m.utcDate), false),
        teamCol_(crestByTeamId_(assets, m.awayTeam.id), shortTeamById_(assets, m.awayTeam.id, m.awayTeam.name), "end")
      ]
    });
  });
  return { type: "bubble", body: { type: "box", layout: "vertical", contents: blocks } };
}

function standingsBubble_(assets, data) {
  const table = data.standings[0].table.slice(0, 10);
  const rows = [
    { type: "text", text: "ตารางคะแนน Top 10", weight: "bold", size: "md", align: "center" },
    { type: "separator", margin: "sm" }
  ];
  table.forEach(r => {
    rows.push({
      type: "box", layout: "horizontal", paddingAll: "xs",
      contents: [
        { type: "text", text: String(r.position), flex: 1 },
        { type: "text", text: shortTeamById_(assets, r.team.id, r.team.name), flex: 5 },
        { type: "text", text: String(r.points) + " pts", flex: 2, align: "end", weight: "bold" }
      ]
    });
  });
  return { type: "bubble", body: { type: "box", layout: "vertical", contents: rows } };
}

function scorersBubble_(data) {
  const rows = [
    { type: "text", text: "ดาวซัลโว", weight: "bold", size: "md", align: "center" },
    { type: "separator", margin: "sm" }
  ];
  data.scorers.slice(0, 10).forEach((s, i) => {
    rows.push({
      type: "box", layout: "horizontal", paddingAll: "xs",
      contents: [
        { type: "text", text: (i + 1) + ". " + s.player.name, flex: 5 },
        { type: "text", text: s.goals + " G", flex: 2, align: "end", color: PL_PURPLE, weight: "bold" }
      ]
    });
  });
  return { type: "bubble", body: { type: "box", layout: "vertical", contents: rows } };
}

/* =========================
 * 9) SETUP & TEST
 * ========================= */
function setup() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));

  // Morning Wrap + Roast (ทุกเช้า 08:00)
  ScriptApp.newTrigger("sendMorningWrap_").timeBased().everyDays(1).atHour(8).create();

  // Weekly Preview (ทุกวันศุกร์ 19:00)
  ScriptApp.newTrigger("sendWeeklyPreview_").timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(19).create();

  // Usage Report (วันที่ 1 ของทุกเดือน 09:00)
  ScriptApp.newTrigger("sendUsageReport_").timeBased().onMonthDay(1).atHour(9).create();
}

function test_ALL() {
  sendMorningWrap_();
  sendWeeklyPreview_();
}

function test_USAGE_REPORT() {
  // สร้าง Sheet ก่อน (ถ้ายังไม่มี)
  const ss = getOrCreateUsageSheet_();
  Logger.log("Sheet URL: " + ss.getUrl());
  Logger.log("Sheet ID: " + ss.getId());

  // ลองสร้าง report (ถ้ามี data)
  sendUsageReport_();
}

/* =========================
 * 10) MOCK TEST
 * ========================= */
function test_MOCK_CONNECTION() {
  const mockMatches = [
    {
      id: 999999,
      utcDate: new Date().toISOString(),
      status: "FINISHED",
      matchday: 99,
      homeTeam: { id: 64, name: "Liverpool FC" },
      awayTeam: { id: 65, name: "Manchester City FC" },
      score: { fullTime: { home: 5, away: 0 } }
    }
  ];

  const mockAssets = {
    "64": { crest: "https://crests.football-data.org/64.png", shortName: "Liverpool" },
    "65": { crest: "https://crests.football-data.org/65.png", shortName: "Man City" }
  };

  linePush_([
    { type: "text", text: "ทดสอบระบบ: นี่คือข้อมูลจำลอง (Mock Data) เพื่อเช็คการเชื่อมต่อบอท" },
    {
      type: "flex",
      altText: "Mock Testing",
      contents: {
        type: "carousel",
        contents: [resultsBubble_("ทดสอบ (Mock)", mockMatches, mockAssets)]
      }
    }
  ]);
}
