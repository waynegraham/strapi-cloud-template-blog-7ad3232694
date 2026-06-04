import pandas as pd
import requests
import json
import time
import re

# Load your distinct materials CSV
df = pd.read_csv('materials_distinct.csv')

GETTY_SPARQL_URL = "https://vocab.getty.edu/sparql"

def extract_core_material(term):
    """
    Cleans up complex strings to extract the core searchable material term.
    e.g., 'Adobe finish structure' -> 'Adobe'
          'Blown and wheel-cut glass' -> 'Glass'
    """
    # Remove common qualifying adjectives and structural words
    text = term.lower()
    text = re.sub(r'\b(finish|structure|blown|wheel-cut|sheet|bars|work|inlaid with.*|and colored.*)\b', '', text)
    
    # Grab the most prominent word (usually the first or last depending on string structure)
    words = text.strip().split()
    if not words:
        return term
    
    # Custom mapping overrides for specific trick terms in your CSV
    overrides = {
        "adobe finish structure": "adobe",
        "aluminosilicate glass folios": "glass",
        "bidri alloy inlaid with silver and brass": "bidri",
        "blackened composition inlay": "inlay",
        "three-channel video installation": "video"
    }
    
    if term.lower() in overrides:
        return overrides[term.lower()]
        
    return words[-1] if len(words) > 1 and words[-1] in ['glass', 'ink', 'leather', 'wood', 'ceramic'] else words[0]

def fetch_aat_id(term):
    """
    Queries Getty SPARQL using a high-performance exact match query on the core term.
    """
    search_term = extract_core_material(term)
    
    # High-performance, low-overhead SPARQL query structure
    query = f"""
    SELECT DISTINCT ?subject WHERE {{
      ?subject a skos:Concept ;
               xl:prefLabel/xl:literalForm "{search_term}"@en .
      FILTER regex(str(?subject), "http://vocab.getty.edu/aat/")
    }} LIMIT 1
    """
    
    try:
        response = requests.get(
            GETTY_SPARQL_URL, 
            params={'query': query, 'format': 'json'}, 
            headers={
                'User-Agent': 'StrapiImporter/1.0 (your-email@example.com)',
                'Accept': 'application/sparql-results+json'
            },
            timeout=8  # Shorter timeout to keep the loop moving
        )
        
        if response.status_code == 200:
            # Safely verify content type header before parsing json
            content_type = response.headers.get('Content-Type', '').lower()
            if 'json' in content_type or 'sparql-results' in content_type:
                data = response.json()
                results = data.get('results', {}).get('bindings', [])
                if results:
                    uri = results[0]['subject']['value']
                    return uri.split('/')[-1]
                    
    except Exception as e:
        # Catch network timeouts or HTML errors quietly without crashing
        pass
        
    return None

# Build the payload structured for Strapi
strapi_payloads = []

print(f"Starting optimized AAT reconciliation for {len(df)} terms...")

for index, row in df.iterrows():
    en_name = str(row['material_en']).strip()
    ar_name = str(row['material_ar']).strip()
    note = str(row['review_note']) if pd.notna(row['review_note']) else ""
    
    # Check for keywords to infer type
    support_keywords = ['canvas', 'paper', 'parchment', 'wood panel', 'tablet', 'fabric', 'linen', 'folios']
    material_type = "support" if any(kw in en_name.lower() for kw in support_keywords) else "medium"
    
    # Execute query
    aat_id = fetch_aat_id(en_name)
    
    if aat_id:
        print(f"[{index+1}/{len(df)}] Matched: '{en_name}' -> AAT ID: {aat_id}")
    else:
        print(f"[{index+1}/{len(df)}] Fallback: '{en_name}' -> Set to MANUAL REVIEW")
        aat_id = "PENDING_REVIEW"

    # Minimal sleep to be nice to the endpoint
    time.sleep(0.1)
    
    item_payload = {
        "type": material_type,
        "vocab": "AAT",
        "refid": aat_id,
        "review_note": note,
        "en_data": {"name": en_name},
        "ar_data": {"name": ar_name}
    }
    strapi_payloads.append(item_payload)

# Save configurations to a structured JSON file ready for Strapi import
with open('strapi_ready_materials.json', 'w', encoding='utf-8') as f:
    json.dump(strapi_payloads, f, ensure_ascii=False, indent=2)

print("\nProcess finished! Your JSON file 'strapi_ready_materials.json' is ready for the Strapi upload step.")