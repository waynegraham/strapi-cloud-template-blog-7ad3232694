const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.join(__dirname, "airtable_dump.json");
const OUTPUT_FILE = path.join(__dirname, "agents_distinct.csv");

const ROLE_FIELDS = [
  { field: "Writer(s)", role: "Writer" },
  { field: "Curator(s)", role: "Curator" },
];

const NAME_AR_BY_NAME_EN = {
  "Ala Younis": "علا يونس",
  "Ana Salazar Herrera": "آنا سالازار هيريرا",
  "Captain Augusto Salgado": "الكابتن أوغوستو سالغادو",
  "David Soin Tappeser": "ديفيد سوين تابيسر",
  "Dr. Ali Akbar": "د. علي أكبر",
  "Dr. Amin Jaffer": "د. أمين جعفر",
  "Dr. Amina Diab": "د. أمينة دياب",
  "Dr. Bilal Badat": "د. بلال بادَت",
  "Dr. Fahad Mubarak AlWahbi": "د. فهد مبارك الوهبي",
  "Dr. Heather Ecker": "د. هيذر إيكر",
  "Dr. James Bennett": "د. جيمس بينيت",
  "Dr. Julian Raby": "د. جوليان رابي",
  "Dr. Luitgard Mols": "د. لويتغارد مولس",
  "Dr. Marcus Fraser": "د. ماركوس فريزر",
  "Dr. Mariam Rosser-Owen": "د. مريم روسر-أوين",
  "Dr. Marika Sardar": "د. ماريكا سردار",
  "Dr. Purificación Marinetto Sánchez": "د. بوريفيكاثيون مارينيتو سانشيز",
  "Dr. Silke Ackermann": "د. سيلكه أكرمان",
  "Dr. Wen Wen": "د. وين وين",
  "Dr. Yahya Nurgat": "د. يحيى نورغات",
  "Ery Sustiyadi": "إيري سوستيادي",
  "Faye Behbehani": "فاي بهبهاني",
  "Himali Singh Soin": "هيمالي سينغ سوين",
  "Inês Bénard": "إينيس بينار",
  "Joana Hadjithomas": "جوانا حاجي توما",
  "Joanna Chevalier": "جوانا شوفالييه",
  "Juan Acevedo": "خوان أسيفيدو",
  "Khalil Joreige": "خليل جريج",
  "Muhannad Shono": "مهند شونو",
  "Sarah Al Abdali": "سارة العبدلي",
  "William Robinson": "ويليام روبنسون",
};

function normalizeName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function addRole(agentMap, rawName, role) {
  const name = normalizeName(rawName);
  if (!name) return;

  const key = name.toLocaleLowerCase();
  if (!agentMap.has(key)) {
    agentMap.set(key, {
      name_en: name,
      name_ar: NAME_AR_BY_NAME_EN[name] || "",
      roles: new Set(),
      writer_count: 0,
      curator_count: 0,
    });
  }

  const agent = agentMap.get(key);
  agent.roles.add(role);

  if (role === "Writer") {
    agent.writer_count += 1;
  } else if (role === "Curator") {
    agent.curator_count += 1;
  }
}

function extractAgents(records) {
  const agentMap = new Map();

  for (const record of records) {
    const fields = record.fields || {};

    for (const { field, role } of ROLE_FIELDS) {
      const values = fields[field];
      if (!Array.isArray(values)) continue;

      for (const value of values) {
        addRole(agentMap, value, role);
      }
    }
  }

  return Array.from(agentMap.values()).sort((a, b) =>
    a.name_en.localeCompare(b.name_en, "en", { sensitivity: "base" }),
  );
}

function toCsv(agents) {
  const header = [
    "name_en",
    "name_ar",
    "roles",
    "is_writer",
    "is_curator",
    "writer_count",
    "curator_count",
  ];

  const rows = agents.map((agent) => {
    const roles = Array.from(agent.roles).sort().join(";");

    return [
      agent.name_en,
      agent.name_ar,
      roles,
      agent.roles.has("Writer") ? "true" : "false",
      agent.roles.has("Curator") ? "true" : "false",
      agent.writer_count,
      agent.curator_count,
    ].map(csvEscape);
  });

  return [header, ...rows].map((row) => row.join(",")).join("\n") + "\n";
}

const records = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
const agents = extractAgents(records);

fs.writeFileSync(OUTPUT_FILE, toCsv(agents));

const writerCount = agents.filter((agent) => agent.roles.has("Writer")).length;
const curatorCount = agents.filter((agent) => agent.roles.has("Curator")).length;
const bothCount = agents.filter(
  (agent) => agent.roles.has("Writer") && agent.roles.has("Curator"),
).length;

console.log(`Wrote ${agents.length} distinct agents to ${OUTPUT_FILE}`);
console.log(`Writers: ${writerCount}`);
console.log(`Curators: ${curatorCount}`);
console.log(`Both roles: ${bothCount}`);
