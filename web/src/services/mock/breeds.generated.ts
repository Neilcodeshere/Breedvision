// GENERATED FILE — do not edit by hand.
// Source: ml/scripts/export_breeds_to_frontend.py
// Regenerate after any change to the dataset's class mapping.
//
// These are the 49 classes the model is actually trained on, taken
// from `class_mapping.json` (dataset version v1).
//
// Every breed here is CATTLE. This dataset contains no buffalo breeds, so
// buffalo identification is out of scope until a separate dataset is sourced
// (see docs/dataset-report.md section 7.4).
//
// `name` is a display rendering of the dataset's folder label. Regions,
// descriptions and characteristics are intentionally absent — they must come
// from ICAR-NBAGR with citations, not from memory.

export interface GeneratedBreed {
  /** URL slug. */
  id: string;
  /** Exact class label used by the model — the join key for predictions. */
  modelLabel: string;
  /** Human-readable name. */
  name: string;
}

export const DATASET_VERSION = "v1";
export const NUM_CLASSES = 49;

export const GENERATED_BREEDS: GeneratedBreed[] = [
  { id: "amritmahal", modelLabel: "Amritmahal", name: "Amritmahal" },
  { id: "bargur", modelLabel: "Bargur", name: "Bargur" },
  { id: "dangi", modelLabel: "Dangi", name: "Dangi" },
  { id: "deoni", modelLabel: "Deoni", name: "Deoni" },
  { id: "gir", modelLabel: "Gir", name: "Gir" },
  { id: "hallikar", modelLabel: "Hallikar", name: "Hallikar" },
  { id: "hariana", modelLabel: "Hariana", name: "Hariana" },
  { id: "himachali-pahari", modelLabel: "Himachali Pahari", name: "Himachali Pahari" },
  { id: "kangayam", modelLabel: "Kangayam", name: "Kangayam" },
  { id: "kankrej", modelLabel: "Kankrej", name: "Kankrej" },
  { id: "kenkatha", modelLabel: "Kenkatha", name: "Kenkatha" },
  { id: "khariar", modelLabel: "Khariar", name: "Khariar" },
  { id: "khillari", modelLabel: "Khillari", name: "Khillari" },
  { id: "konkan-kapila", modelLabel: "Konkan Kapila", name: "Konkan Kapila" },
  { id: "kosali", modelLabel: "Kosali", name: "Kosali" },
  { id: "krishna-valley", modelLabel: "Krishna_Valley", name: "Krishna Valley" },
  { id: "ladakhi", modelLabel: "Ladakhi", name: "Ladakhi" },
  { id: "lakhimi", modelLabel: "Lakhimi", name: "Lakhimi" },
  { id: "malnad-gidda", modelLabel: "Malnad_gidda", name: "Malnad Gidda" },
  { id: "mewati", modelLabel: "Mewati", name: "Mewati" },
  { id: "nari", modelLabel: "Nari", name: "Nari" },
  { id: "nimari", modelLabel: "Nimari", name: "Nimari" },
  { id: "ongole", modelLabel: "Ongole", name: "Ongole" },
  { id: "poda-thirupu", modelLabel: "Poda Thirupu", name: "Poda Thirupu" },
  { id: "pulikulam", modelLabel: "Pulikulam", name: "Pulikulam" },
  { id: "punganur", modelLabel: "Punganur", name: "Punganur" },
  { id: "purnea", modelLabel: "Purnea", name: "Purnea" },
  { id: "rathi", modelLabel: "Rathi", name: "Rathi" },
  { id: "red-kandhari", modelLabel: "Red kandhari", name: "Red Kandhari" },
  { id: "red-sindhi", modelLabel: "Red_Sindhi", name: "Red Sindhi" },
  { id: "sahiwal", modelLabel: "Sahiwal", name: "Sahiwal" },
  { id: "shweta-kapila", modelLabel: "Shweta Kapila", name: "Shweta Kapila" },
  { id: "tharparkar", modelLabel: "Tharparkar", name: "Tharparkar" },
  { id: "umblachery", modelLabel: "Umblachery", name: "Umblachery" },
  { id: "vechur", modelLabel: "Vechur", name: "Vechur" },
  { id: "bachaur", modelLabel: "bachaur", name: "Bachaur" },
  { id: "badri", modelLabel: "badri", name: "Badri" },
  { id: "bhelai", modelLabel: "bhelai", name: "Bhelai" },
  { id: "dagri", modelLabel: "dagri", name: "Dagri" },
  { id: "gangatari", modelLabel: "gangatari", name: "Gangatari" },
  { id: "gaolao", modelLabel: "gaolao", name: "Gaolao" },
  { id: "ghumsari", modelLabel: "ghumsari", name: "Ghumsari" },
  { id: "kherigarh", modelLabel: "kherigarh", name: "Kherigarh" },
  { id: "malvi", modelLabel: "malvi", name: "Malvi" },
  { id: "motu", modelLabel: "motu", name: "Motu" },
  { id: "nagori", modelLabel: "nagori", name: "Nagori" },
  { id: "ponwar", modelLabel: "ponwar", name: "Ponwar" },
  { id: "siri", modelLabel: "siri", name: "Siri" },
  { id: "thutho", modelLabel: "thutho", name: "Thutho" },
];
