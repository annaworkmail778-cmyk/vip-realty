import { cityIdOf, districtIdOf, normalizePlace } from "./places";
import type { Listing, PropertyTypeCode } from "./types";

/* ----------------------------------------------------------------------------
   Recognising SYSTEM-GENERATED listing titles.

   A WhatsApp draft gets a deterministic English title from the database
   (`property_draft_title`, migration 20260918082610), or an AI title that was
   only accepted because every word of it is backed by validated fields:

       "3-room apartment for sale in Avan, Yerevan"
       "4-room house for sale in Erebuni, Yerevan"
       "Land for sale in Yerevan"

   Such a title carries no information beyond the listing's structured fields, so
   the website may render it in the visitor's language from those fields instead.
   A title is treated as system-generated only when it has exactly this shape AND
   every part of it matches the listing's own fields; anything else — a title an
   admin typed, an Armenian title, one that disagrees with the fields after an
   edit — is shown verbatim. Stored titles are never rewritten.

   Client-safe and free of locale data: the localised wording is assembled by
   `fmt.title()` in format.ts.
---------------------------------------------------------------------------- */

export type TitleFields = Pick<
  Listing,
  "name" | "propertyType" | "transactionIntent" | "rooms" | "bedrooms" | "area" | "landArea" | "districtLabel" | "city"
>;

/** Type wording used by the generator, mapped back to the frozen code. */
const GENERATED_TYPES: Record<string, PropertyTypeCode> = {
  apartment: "apartment",
  penthouse: "penthouse",
  house: "house",
  villa: "villa",
  townhouse: "townhouse",
  "commercial space": "commercial",
  office: "office",
  "retail space": "retail",
  warehouse: "warehouse",
  land: "land",
  garage: "garage",
  property: "other",
};

const SHAPE = new RegExp(
  "^(?:(\\d+(?:\\.\\d+)?)-(room|bedroom) |([\\d,]+(?:\\.\\d+)?) m² )?" +
    `(${Object.keys(GENERATED_TYPES).join("|")}) for (sale|rent) in (.+)$`,
  "i",
);

/** One location part of the title ("Avan" / "Yerevan") names the listing's district or city. */
function namesListingPlace(part: string, fields: TitleFields): boolean {
  const p = normalizePlace(part);
  if (!p) return false;
  if (fields.districtLabel && normalizePlace(fields.districtLabel) === p) return true;
  if (normalizePlace(fields.city) === p) return true;
  const district = districtIdOf(part);
  if (district && district === districtIdOf(fields.districtLabel)) return true;
  const city = cityIdOf(part);
  return city !== null && city === cityIdOf(fields.city);
}

export function isGeneratedTitle(fields: TitleFields): boolean {
  const m = SHAPE.exec(fields.name.trim());
  if (!m) return false;
  const [, count, unit, size, typeWord, deal, place] = m;

  if (GENERATED_TYPES[typeWord.toLowerCase()] !== fields.propertyType) return false;
  if ((deal.toLowerCase() === "sale" ? "buy" : "rent") !== fields.transactionIntent) return false;

  if (count !== undefined) {
    const n = Number(count);
    const actual = unit.toLowerCase() === "room" ? fields.rooms : fields.bedrooms;
    if (actual !== n) return false;
  }
  if (size !== undefined) {
    const n = Number(size.replace(/,/g, ""));
    const actual = fields.propertyType === "land" ? fields.landArea : fields.area;
    if (actual === null || Math.abs(actual - n) > 0.5) return false;
  }

  const parts = place.split(/\s*,\s*/).filter(Boolean);
  return parts.length > 0 && parts.every((part) => namesListingPlace(part, fields));
}
