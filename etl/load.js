require("dotenv").config();

const fs = require("fs");
const { format } = require("url");

const STRAPI_API_URL = process.env.STRAPI_API_URL;
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;

let galleryCache = {};
let subGalleryCache = {};
let materialCache = {};
let peopleCache = {};

// Helper function to process footnotes/markup
function cleanAndFormatText(text) {
  if (!text) return "";

  // Example: Convert [^1] style footnotes to HTML superscript anchors
  // Modify this regex to match whatever markup convention you used in Airtable
  let massagedText = text.replace(
    /\[\^(\d+)\]/g,
    '<sup><a href="#fn-$1">$1</a></sup>',
  );

  return massagedText;
}

async function postToStrapi(endpoint, data, token) {
  const response = await fetch(`${STRAPI_API_URL}/api/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Strapi error: ${response.status} - ${errText}`);
  }

  return await response.json();
}

function formatArrayField(fieldValue) {
    return '';
}

function mapGallery(galleryName) {

}

function mapAirtableToStrapi(airtableRecord) {
    const fields = airtableRecord.fields;

    // TODO: need to deal with records with multiple iab_code values (split on ',')

    return {
        iab_code: fields['IAB Code'] || '',
        gallery: fields['Gallery'] || '', 
        sub_gallery: fields['Sub-Gallery'] || '',
        
        writers: formatArrayField('Writer(s)'),
        curators: formatArrayField('Curator(s)'),

        // 
        title_en: fields['Title of Object'] ? fields['Title of Object'].trim() : '',
        title_ar: fields['Title of Object AR'] ? fields['Title of Object AR'].trim() : '',
        description_en: fields['Description'] ? fields['Description'].trim() : '',
        description_ar: fields['Description AR'] ? fields['Description AR'].trim() : '',
        footnotes_en: cleanAndFormatText(fields['Footnotes']),
        footnotes_ar: cleanAndFormatText(fields['Footnotes AR']),
    }
}

async function migrate() {
  const rawData = JSON.parse(fs.readFileSync("airtable_dump.json", "utf-8"));
  console.log(`Loaded ${rawData.length} records from airtable_dump.json`);

  for (const [index,record] of rawData.entries()) {
    const { fields } = record;

    try {

        // split date for hijri/gregorian

        const workPayload = {

            iab_code: fields['IAB Code'] || '',
            gallery: fields['Gallery'] || '',
            sub_gallery: fields['Sub-Gallery'] || '',

            title_en: fields['Title of Object'],
            title_ar: fields['Title of Object AR'],
            description_en: fields['Description'],
            description_ar: fields['Description AR'],
            footnotes_en: cleanAndFormatText(fields['Footnotes']),
            footnotes_ar: cleanAndFormatText(fields['Footnotes AR']),

            origin_en: fields['Origin'],
            origin_ar: fields['Origin AR'],
            credit_line_en: fields['Credit Line'],
            credit_line_ar: fields['Credit Line AR'],

            date_en: fields['Date'], 
            date_ar: fields['Date AR'],

            medium_en: fields['Medium'],
            medium_ar: fields['Medium AR'],
            dimensions_en: fields['Dimensions'],
            dimensions_ar: fields['Dimensions AR'],

        };

        console.log(`[${index + 1}/${rawData.length}] Migrating: ${englishPayload.title}`);
        // Post English Version
        const workResult = await postToStrapi('works', englishPayload, STRAPI_API_TOKEN);
        const workEntryId = workResult.data.id;




    } catch (error) {
        console.error(`❌ Failed to migrate record ID ${record.id}:`, error.message);
        // for retry
        fs.appendFileSync('failed_migrations.log', `${record.id}: ${error.message}\n`);
    }
  }
  console.log('Migration process complete.');
}

migrate();
