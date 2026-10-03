// Tests for the listing display layer: generated-title recognition, localised
// titles and place names, the rooms filter, and dictionary hygiene.
// Run: npm run test:listings
import { test } from "node:test";
import assert from "node:assert/strict";
import { hy } from "../i18n/dictionaries/hy.ts";
import { ru } from "../i18n/dictionaries/ru.ts";
import { en } from "../i18n/dictionaries/en.ts";
import { createFormat } from "./format.ts";
import { isGeneratedTitle } from "./titles.ts";
import { YEREVAN_DISTRICT_IDS, cityIdOf, districtIdOf } from "./places.ts";
import { parseListingSearch } from "./filters.ts";

const fmt = { hy: createFormat("hy", hy), ru: createFormat("ru", ru), en: createFormat("en", en) };

const listing = (overrides) => ({
  name: "",
  propertyType: "apartment",
  transactionIntent: "buy",
  rooms: null,
  bedrooms: null,
  area: null,
  landArea: null,
  districtLabel: null,
  city: "Yerevan",
  ...overrides,
});

// Shapes of the six listings published at the time of writing (titles as stored).
const avan = listing({ name: "3-room apartment for sale in Avan", rooms: 3, area: 72, districtLabel: "Avan" });
const rental = listing({ name: "2-room apartment for rent in Yerevan", transactionIntent: "rent", rooms: 2 });
const erebuni = listing({
  name: "4-room house for sale in Erebuni, Yerevan", propertyType: "house", rooms: 4, districtLabel: "Erebuni",
});

test("generated titles are recognised only when every part matches the listing", () => {
  assert.equal(isGeneratedTitle(avan), true);
  assert.equal(isGeneratedTitle(rental), true);
  assert.equal(isGeneratedTitle(erebuni), true);
  assert.equal(isGeneratedTitle(listing({ ...avan, name: "3-room apartment for sale in Avan, Yerevan" })), true);
  // stored district in Armenian script, title in English
  assert.equal(isGeneratedTitle(listing({ ...avan, districtLabel: "Ավան" })), true);
  assert.equal(isGeneratedTitle(listing({
    name: "1,200 m² land for sale in Yerevan", propertyType: "land", landArea: 1200,
  })), true);
  assert.equal(isGeneratedTitle(listing({
    name: "2-bedroom apartment for sale in Kentron, Yerevan", bedrooms: 2, rooms: 3, districtLabel: "Kentron",
  })), true);

  // custom, edited or non-English titles stay verbatim
  assert.equal(isGeneratedTitle(listing({ ...avan, name: "Sunny apartment near the Cascade" })), false);
  assert.equal(isGeneratedTitle(listing({ ...avan, rooms: 2 })), false, "room count disagrees");
  assert.equal(isGeneratedTitle(listing({ ...avan, transactionIntent: "rent" })), false, "intent disagrees");
  assert.equal(isGeneratedTitle(listing({ ...avan, propertyType: "house" })), false, "type disagrees");
  assert.equal(isGeneratedTitle(listing({ ...avan, districtLabel: "Arabkir" })), false, "place disagrees");
  assert.equal(isGeneratedTitle(listing({ ...avan, name: "Բնակարան Ավանում" })), false);
});

test("generated titles are rendered in the UI language from the structured fields", () => {
  assert.equal(fmt.hy.title(avan), "Վաճառվում է 3 սենյականոց բնակարան, Ավան, Երևան");
  assert.equal(fmt.ru.title(avan), "Продаётся 3-комнатная квартира, Аван, Ереван");
  assert.equal(fmt.en.title(avan), "3-room apartment for sale in Avan, Yerevan");

  assert.equal(fmt.hy.title(rental), "Վարձով է տրվում 2 սենյականոց բնակարան, Երևան");
  assert.equal(fmt.ru.title(rental), "Сдаётся 2-комнатная квартира, Ереван");
  assert.equal(fmt.en.title(rental), "2-room apartment for rent in Yerevan");

  assert.equal(fmt.hy.title(erebuni), "Վաճառվում է 4 սենյականոց առանձնատուն, Էրեբունի, Երևան");
  assert.equal(fmt.ru.title(erebuni), "Продаётся 4-комнатный дом, Эребуни, Ереван");
  assert.equal(fmt.en.title(erebuni), "4-room house for sale in Erebuni, Yerevan");

  // short form for tiles that show the place on their own line
  assert.equal(fmt.hy.title(avan, { short: true }), "Վաճառվում է 3 սենյականոց բնակարան");
  assert.equal(fmt.ru.title(rental, { short: true }), "Сдаётся 2-комнатная квартира");
  assert.equal(fmt.en.title(erebuni, { short: true }), "4-room house for sale");

  const land = listing({ name: "1,200 m² land for sale in Yerevan", propertyType: "land", landArea: 1200 });
  assert.equal(fmt.hy.title(land), "Վաճառվում է հողատարածք, Երևան");
  assert.equal(fmt.en.title(land), "Land plot for sale in Yerevan");
});

test("custom titles and unknown places are never rewritten", () => {
  const custom = listing({ ...avan, name: "Sunny apartment near the Cascade" });
  for (const f of Object.values(fmt)) assert.equal(f.title(custom), "Sunny apartment near the Cascade");

  const unknown = listing({ districtLabel: "Dzoraghbyur", city: "Kotayk" });
  assert.equal(fmt.hy.place(unknown), "Dzoraghbyur, Kotayk");
  assert.equal(fmt.ru.districtFirstLine(unknown), "Dzoraghbyur · Kotayk");
});

test("place lines are localised", () => {
  assert.equal(fmt.hy.place(avan), "Ավան, Երևան");
  assert.equal(fmt.ru.districtFirstLine(avan), "Аван · Ереван");
  assert.equal(fmt.en.locationLine(avan), "Yerevan · Avan");
  assert.equal(fmt.hy.locationLine(rental), "Երևան");
  assert.equal(fmt.hy.imageAlt("Վաճառվում է բնակարան", 2), "Վաճառվում է բնակարան, լուսանկար 2");
});

test("prices and numbers do not depend on the runtime's locale data", () => {
  const sale = { price: 147000, currency: "USD", period: null };
  const rent = { price: 260000, currency: "AMD", period: "month" };
  const nb = " ";

  assert.equal(fmt.hy.price(sale), `147${nb}000${nb}$`);
  assert.equal(fmt.ru.price(sale), `147${nb}000${nb}$`);
  assert.equal(fmt.en.price(sale), "$147,000");
  assert.equal(fmt.hy.price(rent), `260${nb}000${nb}֏${hy.period.month}`);
  assert.equal(fmt.ru.price(rent), `260${nb}000${nb}֏${ru.period.month}`, "֏, not AMD");
  assert.equal(fmt.en.price({ price: 260000, currency: "AMD", period: null }), "֏260,000");
  assert.equal(fmt.en.price({ price: 95000, currency: "RUB", period: null }), "₽95,000");

  assert.equal(fmt.hy.number(1234.5), "1234,5", "Armenian groups from five digits");
  assert.equal(fmt.hy.number(12345), `12${nb}345`);
  assert.equal(fmt.ru.number(1234.5), `1${nb}234,5`);
  assert.equal(fmt.en.number(1234.5), "1,234.5");
  assert.equal(fmt.hy.area(72), `72 ${hy.units.area}`);

  // Same output as full-ICU Intl (what the server rendered before) for USD, EUR and plain numbers.
  const tags = { hy: "hy-AM", ru: "ru-RU", en: "en-US" };
  for (const [locale, tag] of Object.entries(tags)) {
    for (const amount of [1, 999, 1000, 9999, 12345, 147000, 1250000, 12345678]) {
      for (const currency of ["USD", "EUR"]) {
        const expected = new Intl.NumberFormat(tag, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
        assert.equal(fmt[locale].price({ price: amount, currency, period: null }), expected, `${locale} ${currency} ${amount}`);
      }
    }
    for (const n of [0, 7, 52, 72.5, 268, 1000, 1234.5, 99999.25, 123456.789]) {
      assert.equal(fmt[locale].number(n), new Intl.NumberFormat(tag).format(n), `${locale} number ${n}`);
    }
  }
});

test("Yerevan districts and the city resolve from any script", () => {
  const cases = {
    Avan: "avan", "Ավան": "avan", "Аван": "avan", "AVAN district": "avan",
    "Nor Nork": "nor-nork", "Նոր Նորք": "nor-nork", "Kanaker Zeytun": "kanaker-zeytun",
    "Центр": "kentron", "Malatia-Sebastia": "malatia-sebastia", "р-н Шенгавит": "shengavit",
  };
  for (const [label, id] of Object.entries(cases)) assert.equal(districtIdOf(label), id, label);
  assert.equal(districtIdOf("Yerevan"), null);
  assert.equal(districtIdOf("Dzoraghbyur"), null);
  assert.equal(districtIdOf(null), null);

  for (const label of ["Yerevan", "Երևան", "Երեւան", "Ереван", "г. Ереван"]) assert.equal(cityIdOf(label), "yerevan", label);
  assert.equal(cityIdOf("Gyumri"), null);
});

test("the rooms filter reads ?rooms= and still accepts the old ?bedrooms=", () => {
  assert.equal(parseListingSearch({ rooms: "3" }).rooms, "3");
  assert.equal(parseListingSearch({ bedrooms: "2" }).rooms, "2", "legacy alias");
  assert.equal(parseListingSearch({ rooms: "3", bedrooms: "2" }).rooms, "3", "rooms wins");
  assert.equal(parseListingSearch({ rooms: "9" }).rooms, "any", "unknown value ignored");
  assert.equal(parseListingSearch({}).rooms, "any");
  assert.equal("bedrooms" in parseListingSearch({ bedrooms: "2" }), false);
});

test("dictionaries share one shape and carry no developer or placeholder wording", () => {
  const keys = (o, p = "") =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === "object" && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]);
  const values = (o) => Object.values(o).flatMap((v) => (v && typeof v === "object" ? values(v) : [String(v)]));

  assert.deepEqual(keys(ru).sort(), keys(hy).sort());
  assert.deepEqual(keys(en).sort(), keys(hy).sort());

  for (const [name, dict] of Object.entries({ hy, ru, en })) {
    const offenders = values(dict).filter((v) =>
      /lib\/|\.ts\b|placeholder|ժամանակավոր երկրաչափ|условная геометрия|предварительн/i.test(v));
    assert.deepEqual(offenders, [], `${name} has developer/placeholder wording`);
    assert.deepEqual(Object.keys(dict.districts).sort(), [...YEREVAN_DISTRICT_IDS].sort(), `${name} districts`);
    assert.ok(dict.filters.rooms && !("bedrooms" in dict.filters), `${name} filter is labelled rooms`);
  }
});
