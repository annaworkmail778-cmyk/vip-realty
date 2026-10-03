/* ----------------------------------------------------------------------------
   Yerevan place names: the twelve administrative districts and the city.

   Listings store the district and city as free text, in whatever spelling and
   script the extraction or the agent produced ("Avan", "Ավան", "Аван"). This
   resolves such a stored value to a frozen id so the website can show the name
   in the visitor's language and filter on it. A value that is not recognised
   resolves to null and is shown exactly as stored — nothing is guessed.

   The ids equal `placeId()` of the English name, so existing `?district=` URLs
   keep working. Display labels live in the dictionaries (dict.districts,
   dict.cities). Client-safe and dependency-free.
---------------------------------------------------------------------------- */

export const YEREVAN_DISTRICT_IDS = [
  "ajapnyak",
  "arabkir",
  "avan",
  "davtashen",
  "erebuni",
  "kanaker-zeytun",
  "kentron",
  "malatia-sebastia",
  "nor-nork",
  "nork-marash",
  "nubarashen",
  "shengavit",
] as const;

export type DistrictId = (typeof YEREVAN_DISTRICT_IDS)[number];

export type CityId = "yerevan";

/** Spellings seen in listings, in Latin, Armenian and Cyrillic script. Matching is
 *  case-insensitive and ignores spaces vs hyphens and a trailing "district". */
const DISTRICT_ALIASES: Record<DistrictId, readonly string[]> = {
  ajapnyak: ["ajapnyak", "ajapnjak", "ajapniak", "adzhapnyak", "աջափնյակ", "аджапняк"],
  arabkir: ["arabkir", "արաբկիր", "арабкир"],
  avan: ["avan", "ավան", "аван"],
  davtashen: ["davtashen", "davitashen", "դավթաշեն", "давташен"],
  erebuni: ["erebuni", "էրեբունի", "эребуни"],
  "kanaker-zeytun": ["kanaker-zeytun", "kanaker-zeitun", "քանաքեռ-զեյթուն", "канакер-зейтун"],
  kentron: ["kentron", "center", "centre", "կենտրոն", "кентрон", "центр"],
  "malatia-sebastia": ["malatia-sebastia", "malatya-sebastia", "մալաթիա-սեբաստիա", "малатия-себастия"],
  "nor-nork": ["nor-nork", "նոր-նորք", "нор-норк"],
  "nork-marash": ["nork-marash", "նորք-մարաշ", "норк-мараш"],
  nubarashen: ["nubarashen", "նուբարաշեն", "нубарашен"],
  shengavit: ["shengavit", "շենգավիթ", "шенгавит"],
};

const CITY_ALIASES: Record<CityId, readonly string[]> = {
  yerevan: ["yerevan", "erevan", "երևան", "ереван"],
};

/** Words that qualify a place name without changing it ("Avan district", "р-н Аван"). */
const QUALIFIERS = /(^|-)(district|region|adm|համայնք|վարչական|շրջան|район|р-н|г|город|city)(?=-|$)/g;

/** Comparable form: lower case, "եւ" as "և", "ё" as "е", any run of spaces,
 *  hyphens, dots or commas collapsed to one hyphen, qualifiers removed. */
export function normalizePlace(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/եւ/g, "և")
    .replace(/ё/g, "е")
    .replace(/[\s.,_/–—-]+/g, "-")
    .replace(QUALIFIERS, "$1")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const index = <T extends string>(aliases: Record<T, readonly string[]>) => {
  const map = new Map<string, T>();
  for (const [id, names] of Object.entries(aliases) as [T, readonly string[]][]) {
    for (const name of names) map.set(normalizePlace(name), id);
  }
  return map;
};

const DISTRICTS = index(DISTRICT_ALIASES);
const CITIES = index(CITY_ALIASES);

/** The Yerevan district a stored value names, or null when it is not one we know. */
export function districtIdOf(value: string | null | undefined): DistrictId | null {
  return value ? DISTRICTS.get(normalizePlace(value)) ?? null : null;
}

/** The city a stored value names, or null when it is not one we know. */
export function cityIdOf(value: string | null | undefined): CityId | null {
  return value ? CITIES.get(normalizePlace(value)) ?? null : null;
}
