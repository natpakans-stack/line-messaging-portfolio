/*******************************************************
 * LINE Daily Push + AI Blessing
 * ส่งทุกวัน 06:30
 * Usage tracking → เขียนลง Google Sheet เดียวกับ EPL Bot
 *******************************************************/

const OPENAI_MODEL = "gpt-4o-mini";
const TIMEZONE = "Asia/Bangkok";

// gpt-4o-mini pricing (USD per 1M tokens)
const GPT_PRICE_INPUT  = 0.15;
const GPT_PRICE_OUTPUT = 0.60;

// ===== ตารางสีมงคล =====
const COLOR_MAP_BY_DAY = {
  "วันจันทร์": { work: "สีส้ม / สีน้ำตาล", money: "สีม่วง / สีดำ", love: "สีเขียว", senior: "สีฟ้า / สีน้ำเงิน", bad: "สีแดง" },
  "วันอังคาร": { work: "สีม่วง", money: "สีส้ม / สีน้ำตาล", love: "สีม่วง / สีดำ", senior: "สีแดง", bad: "สีเหลือง / สีเทา" },
  "วันพุธ": { work: "สีฟ้า / สีน้ำเงิน", money: "สีม่วง", love: "สีส้ม / สีน้ำตาล", senior: "สีเหลือง / สีเทา", bad: "สีชมพู" },
  "วันพฤหัสบดี": { work: "สีเหลือง / สีเทา", money: "สีแดง", love: "สีฟ้า / สีน้ำเงิน", senior: "สีเขียว", bad: "สีดำ / สีม่วง" },
  "วันศุกร์": { work: "สีเขียว", money: "สีชมพู", love: "สีเหลือง / สีเทา", senior: "สีส้ม / สีน้ำตาล", bad: "สีม่วง" },
  "วันเสาร์": { work: "สีแดง", money: "สีฟ้า / สีน้ำเงิน", love: "สีม่วง", senior: "สีชมพู", bad: "สีเขียว" },
  "วันอาทิตย์": { work: "สีม่วง / สีดำ", money: "สีเขียว", love: "สีชมพู", senior: "สีม่วง", bad: "สีฟ้า / สีน้ำเงิน" },
};

// ===== Main =====
function sendDailyColorCard() {

  const token = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  const to = PropertiesService.getScriptProperties().getProperty("LINE_TO");

  if (!token || !to) throw new Error("Missing LINE token");

  const now = new Date();
  const dayTH = getThaiWeekday_(now);

  const dateText = `${dayTH} ที่ ${pad2_(now.getDate())}`;

  const colors = COLOR_MAP_BY_DAY[dayTH];

  // เรียก AI
  const blessing = generateBlessingAI_(dayTH);

  const bubble = buildFlexBubble_({
    dateText,
    colors,
    blessing
  });

  pushFlex_(token, to, bubble);

}

// ===== AI Blessing =====
function generateBlessingAI_(dayTH) {

  try {

    const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");

    const payload = {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "คุณคือผู้หญิงน่ารักอบอุ่นที่ส่งคำอวยพรตอนเช้าให้ครอบครัว ใช้ภาษาสุภาพแบบผู้หญิง (ค่ะ, นะคะ, จ้า) ใส่อิโมจิ 1-2 ตัว"
        },
        {
          role: "user",
          content: `วันนี้คือ${dayTH} ช่วยเขียนคำอวยพรสั้นๆ ให้ครอบครัว ภาษาไทย 1-2 ประโยค ลงท้ายด้วยค่ะหรือนะคะ`
        }
      ],
      temperature: 0.9
    };

    const response = UrlFetchApp.fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "post",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );

    const json = JSON.parse(response.getContentText());
    trackUsage_(json.usage, "daily-blessing");

    const text = json.choices[0].message.content;

    return text;

  } catch (e) {

    return "ขอให้วันนี้เป็นวันที่ดีของครอบครัวเรานะคะ สุขภาพแข็งแรงและมีแต่เรื่องดีๆ ค่ะ 🌼✨";

  }

}

// ===== GPT Usage Tracker (เขียนลง Sheet เดียวกับ EPL Bot) =====

/** บันทึก token usage หลังเรียก GPT */
function trackUsage_(usage, label) {
  if (!usage) return;

  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("GPT_USAGE_LOG") || "{}";
  let log;
  try { log = JSON.parse(raw); } catch (e) { log = {}; }

  const month = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM");

  if (!log[month]) log[month] = { calls: 0, promptTokens: 0, completionTokens: 0 };

  log[month].calls += 1;
  log[month].promptTokens += (usage.prompt_tokens || 0);
  log[month].completionTokens += (usage.completion_tokens || 0);

  props.setProperty("GPT_USAGE_LOG", JSON.stringify(log));

  // เขียนลง Google Sheet ทันที
  writeUsageToSheet_(log);

  Logger.log("[Usage] " + label + ": " + (usage.prompt_tokens || 0) + " in / " + (usage.completion_tokens || 0) + " out");
}

/** เขียน usage ลง Google Sheet (Sheet เดียวกับ EPL Bot) */
function writeUsageToSheet_(log) {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty("USAGE_SHEET_ID");
  if (!sheetId) {
    Logger.log("No USAGE_SHEET_ID — skip sheet write. Copy the Sheet ID from EPL Bot script.");
    return;
  }

  let ss;
  try { ss = SpreadsheetApp.openById(sheetId); } catch (e) {
    Logger.log("Cannot open sheet: " + e.message);
    return;
  }

  // ใช้ sheet ชื่อ "Blessing" แยกจาก "Usage" ของ EPL Bot
  let sheet = ss.getSheetByName("Blessing");
  if (!sheet) {
    sheet = ss.insertSheet("Blessing");
    sheet.appendRow(["Month", "Calls", "Input Tokens", "Output Tokens", "Cost (USD)", "Cost (THB)", "Updated"]);
    sheet.getRange(1, 1, 1, 7).setFontWeight("bold");
  }

  const months = Object.keys(log).sort();
  months.forEach(m => {
    const d = log[m];
    const cost = (d.promptTokens / 1000000) * GPT_PRICE_INPUT + (d.completionTokens / 1000000) * GPT_PRICE_OUTPUT;
    const costTHB = cost * 34;
    const rowData = [m, d.calls, d.promptTokens, d.completionTokens, +cost.toFixed(4), +costTHB.toFixed(2), new Date()];

    const existing = findRowByMonth_(sheet, m);
    if (existing > 0) {
      sheet.getRange(existing, 1, 1, 7).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }
  });
}

/** หาแถวของเดือนที่ระบุ */
function findRowByMonth_(sheet, month) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === month) return i + 2;
  }
  return -1;
}

// ===== Flex UI =====
function buildFlexBubble_(info) {

  return {
    type: "bubble",
    hero: {
      type: "image",
      url: "https://res.cloudinary.com/din3e669q/image/upload/v1766455505/ดูดวง_12_ราศี_bl19dg.jpg",
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover"
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [

        {
          type: "text",
          text: info.dateText,
          weight: "bold",
          size: "xl"
        },

        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          contents: [
            row_("การงาน", info.colors.work),
            row_("การเงิน", info.colors.money),
            row_("ความรัก", info.colors.love),
            row_("ผู้ใหญ่เมตตา", info.colors.senior),
            row_("กาลกิณี", info.colors.bad)
          ]
        },

        {
          type: "text",
          text: info.blessing,
          wrap: true,
          size: "sm",
          margin: "xl",
          color: "#888888"
        }

      ]
    }
  };

}

function row_(label, value) {

  return {
    type: "box",
    layout: "baseline",
    contents: [
      { type: "text", text: label, size: "sm", color: "#aaaaaa", flex: 2 },
      { type: "text", text: value, size: "sm", color: "#666666", flex: 5, wrap: true }
    ]
  };

}

// ===== Push LINE =====
function pushFlex_(token, to, bubble) {

  const url = "https://api.line.me/v2/bot/message/push";

  const payload = {
    to: to,
    messages: [
      {
        type: "flex",
        altText: "Daily Fortune",
        contents: bubble
      }
    ]
  };

  UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token
    },
    payload: JSON.stringify(payload)
  });

}

// ===== Utils =====
function getThaiWeekday_(d) {
  const map = ["วันอาทิตย์","วันจันทร์","วันอังคาร","วันพุธ","วันพฤหัสบดี","วันศุกร์","วันเสาร์"];
  return map[d.getDay()];
}

function pad2_(n) {
  return (n < 10 ? "0" : "") + n;
}
