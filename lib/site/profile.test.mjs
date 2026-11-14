// Tests for the agency-contact helpers. Run: npm run test:listings
// Numbers below are synthetic, not the agency's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PROFILE, formatPhone, mapsUrl, telLink, viberUrl, whatsappUrl } from "./profile.ts";

const profile = { ...EMPTY_PROFILE, configured: true, phone: "+37410000001", whatsapp: "37410000002", officeAddress: "Example St 1/2, Yerevan" };

test("Armenian numbers are shown grouped; others as stored", () => {
  assert.equal(formatPhone("+37410000001"), "+374 10 00 00 01");
  assert.equal(formatPhone("+15550100"), "+15550100");
});

test("contact links exist only for configured details", () => {
  assert.equal(telLink("+374 10 00-00 01"), "tel:+37410000001");
  assert.equal(telLink(null), null);
  assert.equal(viberUrl(profile), "viber://chat?number=%2B37410000002");
  assert.match(whatsappUrl(profile, "Hi"), /^https:\/\/wa\.me\/37410000002\?text=Hi$/);
  assert.equal(mapsUrl(profile), "https://www.google.com/maps/search/?api=1&query=Example%20St%201%2F2%2C%20Yerevan");
  for (const f of [viberUrl, mapsUrl]) assert.equal(f(EMPTY_PROFILE), null);
  assert.equal(whatsappUrl(EMPTY_PROFILE, "Hi"), null);
});
