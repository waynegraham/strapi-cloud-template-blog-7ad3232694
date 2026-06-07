require('dotenv').config();

const AirTable = require('airtable');
const fs = require('fs');

const base = new AirTable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const tableName = process.env.AIRTABLE_TABLE_NAME;

async function extractData() {
    console.log('Extracting data from Airtable...');
    const allRecords = [];

    try {
        // select() returns a query object; eachPage automatically handles Airtable's 100-record pagination limit
        await base(tableName).select({
            view: 'Master view', // Adjust if the the has a specific name
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                allRecords.push({
                    id: record.id,
                    fields: record.fields
                });
            });
            fetchNextPage();
        });

        fs.writeFileSync('airtable_dump.json', JSON.stringify(allRecords, null, 2));
        console.log(`Successfully extracted ${allRecords.length} records from Airtable and saved to airtable_dump.json`);
    } catch (error) {
        console.error('Error extracting data from Airtable:', error);
    }
}

extractData();