/**
 * Reference facts for the breed library, keyed by breed slug.
 *
 * `region` for every breed is the home state(s) listed on the ICAR-NBAGR
 * "Cattle Breeds of India" registry page (nbagr.res.in/cattle-breed). That is
 * the only field with a registry citation.
 *
 * `use` and `notes` are well-established general descriptions of the breed
 * and are included only where they are widely documented; a breed with no
 * `use`/`notes` simply has none recorded rather than a guess. They have not
 * been line-checked against each NBAGR breed monograph, which is why the
 * source label says so.
 *
 * Dataset labels that differ from the registry spelling:
 *   Bhelai    -> registry "Belahi"   (Haryana and Chandigarh)
 *   Gangatari -> registry "Gangatiri"
 *   Ghumsari  -> registry "Ghumusari"
 *   Khillari  -> registry "Khillar"
 */

export interface BreedInfo {
  region: string;
  use?: "Milch" | "Draught" | "Dual purpose";
  /** One or two plain sentences; only widely documented traits. */
  notes?: string;
  related?: string[];
}

export const BREED_SOURCE = "ICAR-NBAGR cattle breed registry (home tract); use and notes are a general summary";
export const BREED_SOURCE_URL = "https://nbagr.res.in/cattle-breed";

export const BREED_INFO: Record<string, BreedInfo> = {
  amritmahal: { region: "Karnataka", use: "Draught", notes: "A lean grey draught breed with long, sweeping horns, historically valued for speed and endurance.", related: ["hallikar", "khillari"] },
  bargur: { region: "Tamil Nadu", use: "Draught", notes: "Hill cattle of the Bargur forest tract, brown with white markings, known as quick, hardy trotters." },
  dangi: { region: "Maharashtra and Gujarat", use: "Draught", notes: "Bred for heavy-rainfall hill country; usually white with red or black patches.", related: ["deoni"] },
  deoni: { region: "Maharashtra and Karnataka", use: "Dual purpose", notes: "Black-and-white or red-and-white spotted cattle with a distinctive bulging forehead.", related: ["dangi"] },
  gir: { region: "Gujarat", use: "Milch", notes: "A leading Indian dairy breed: a domed forehead and long, pendulous, curled ears; coat from red to spotted.", related: ["kankrej", "sahiwal"] },
  hallikar: { region: "Karnataka", use: "Draught", notes: "Grey draught cattle with long, vertically rising horns that sweep back.", related: ["amritmahal", "khillari"] },
  hariana: { region: "Haryana, Uttar Pradesh and Rajasthan", use: "Dual purpose", notes: "White to light-grey cattle, valued both for milk and for draught work.", related: ["mewati", "rathi"] },
  "himachali-pahari": { region: "Himachal Pradesh", notes: "Small, hardy hill cattle adapted to steep terrain." },
  kangayam: { region: "Tamil Nadu", use: "Draught", notes: "Compact, powerful grey-white draught cattle with strong, curved horns.", related: ["pulikulam", "umblachery"] },
  kankrej: { region: "Gujarat and Rajasthan", use: "Dual purpose", notes: "Silver-grey to iron-grey cattle with large lyre-shaped horns.", related: ["gir", "tharparkar"] },
  kenkatha: { region: "Uttar Pradesh and Madhya Pradesh", use: "Draught", notes: "Small, compact cattle of the Ken river valley." },
  khariar: { region: "Odisha" },
  khillari: { region: "Maharashtra and Karnataka", use: "Draught", notes: "Grey-white draught cattle with tapering horns, known for pace and stamina.", related: ["hallikar", "amritmahal"] },
  "konkan-kapila": { region: "Maharashtra and Goa" },
  kosali: { region: "Chhattisgarh" },
  "krishna-valley": { region: "Karnataka", use: "Draught", notes: "A large, mostly white draught breed of the Krishna river tract." },
  ladakhi: { region: "Jammu & Kashmir (Ladakh)", notes: "Cold-adapted cattle of the high Himalayan plateau." },
  lakhimi: { region: "Assam" },
  "malnad-gidda": { region: "Karnataka", notes: "A very small hill breed of the Western Ghats (Malnad), noted for hardiness and disease tolerance." },
  mewati: { region: "Rajasthan, Haryana and Uttar Pradesh", use: "Draught", notes: "White, robust cattle similar to the Hariana type.", related: ["hariana"] },
  nari: { region: "Rajasthan and Gujarat" },
  nimari: { region: "Madhya Pradesh", use: "Dual purpose", notes: "Red cattle with white patches from the Nimar region." },
  ongole: { region: "Andhra Pradesh", use: "Draught", notes: "Large white cattle with a prominent hump and short horns; also valued for beef-cross breeding abroad.", related: ["punganur"] },
  "poda-thirupu": { region: "Telangana" },
  pulikulam: { region: "Tamil Nadu", use: "Draught", notes: "Small, agile cattle traditionally used in the jallikattu bull-taming events.", related: ["kangayam", "umblachery"] },
  punganur: { region: "Andhra Pradesh", use: "Milch", notes: "One of the world's smallest humped breeds, known for milk with a high fat content.", related: ["ongole"] },
  purnea: { region: "Bihar" },
  rathi: { region: "Rajasthan", use: "Milch", notes: "A desert dairy breed, typically brown with white patches.", related: ["hariana", "tharparkar", "sahiwal"] },
  "red-kandhari": { region: "Maharashtra", use: "Draught", notes: "Dark red cattle of the Marathwada region." },
  "red-sindhi": { region: "Organized farms only (no home state in the registry)", use: "Milch", notes: "A deep red dairy breed with a compact build and good heat tolerance.", related: ["sahiwal"] },
  sahiwal: { region: "Punjab and Rajasthan", use: "Milch", notes: "A heat-tolerant dairy breed: reddish-brown coat, loose skin and a pronounced dewlap.", related: ["red-sindhi", "gir", "rathi"] },
  "shweta-kapila": { region: "Goa" },
  tharparkar: { region: "Rajasthan", use: "Dual purpose", notes: "White to light-grey cattle of the Thar desert region.", related: ["kankrej", "rathi"] },
  umblachery: { region: "Tamil Nadu", use: "Draught", notes: "Short, sturdy draught cattle suited to wet paddy fields of the Cauvery delta.", related: ["kangayam", "pulikulam"] },
  vechur: { region: "Kerala", use: "Milch", notes: "One of the smallest cattle breeds in the world, valued for hardiness and milk quality." },
  bachaur: { region: "Bihar", use: "Draught" },
  badri: { region: "Uttarakhand", notes: "Small hill cattle of the Garhwal Himalaya." },
  bhelai: { region: "Haryana and Chandigarh (registry name: Belahi)" },
  dagri: { region: "Gujarat" },
  gangatari: { region: "Uttar Pradesh and Bihar (registry name: Gangatiri)" },
  gaolao: { region: "Maharashtra and Madhya Pradesh" },
  ghumsari: { region: "Odisha (registry name: Ghumusari)" },
  kherigarh: { region: "Uttar Pradesh" },
  malvi: { region: "Madhya Pradesh", use: "Draught", notes: "Draught cattle of the Malwa plateau." },
  motu: { region: "Odisha, Chhattisgarh and Andhra Pradesh" },
  nagori: { region: "Rajasthan", use: "Draught", notes: "Fast trotting draught cattle of the Nagaur area." },
  ponwar: { region: "Uttar Pradesh" },
  siri: { region: "Sikkim and West Bengal", notes: "Hill cattle of the eastern Himalaya." },
  thutho: { region: "Nagaland" },
};
