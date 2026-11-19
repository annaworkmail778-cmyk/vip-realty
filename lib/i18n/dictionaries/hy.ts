/* ----------------------------------------------------------------------------
   Armenian — the source of truth for the dictionary SHAPE.

   `lib/i18n/types.ts` derives `Dictionary` from this object, and the Russian and
   English files are typed against it, so a missing or misspelled key fails
   `tsc --noEmit` rather than rendering `undefined` in production.

   This translates the WEBSITE only. Listing descriptions come from the database
   and are rendered exactly as stored, in whatever language the agent wrote them.
   Two kinds of stored value are shown in the visitor's language instead, because
   they carry nothing the structured fields do not: a recognised Yerevan district
   or city name (`districts`, `cities`), and a system-generated English title
   (`listingTitle`, see lib/listings/titles.ts). Any other title stays verbatim.

   Taxonomy keys below (`apartments`, `0-150`, `apartment`, …) mirror the frozen
   ids in lib/listings/taxonomy.ts and the property_type codes in the database.
   They are lookup keys, never URL values — the ids themselves are untouched.

   `{placeholders}` in a string are substituted by the caller. Plural triples
   (`one` / `few` / `many`) are selected with Intl.PluralRules; Armenian keeps a
   single form after a numeral, so all three are identical here by design.
---------------------------------------------------------------------------- */

export const hy = {
  locale: {
    label: "Լեզու",
    change: "Փոխել լեզուն",
  },

  gate: {
    // Shown in all three languages, so a visitor who does not read the default
    // one can still find their own. Identical in every dictionary by design.
    headings: ["Ընտրեք լեզուն", "Выберите язык", "Choose your language"],
    note: "Կարող եք փոխել այն ցանկացած պահի։",
  },

  nav: {
    home: "Գլխավոր",
    properties: "Գույքեր",
    buy: "Վաճառք",
    rent: "Վարձակալություն",
    land: "Հողատարածք",
    about: "Մեր մասին",
    contact: "Կապ",
    menu: "Մենյու",
    close: "Փակել",
    search: "Որոնում",
    searchTitle: "Որոնել գույք",
    skipToContent: "Անցնել բովանդակությանը",
    primary: "Հիմնական նավիգացիա",
  },

  brand: {
    tagline: "Անշարժ գույքի պրեմիում լուծումներ",
    concept: "Տուն գտնելու արվեստը",
    city: "Երևան",
    /* Armenian and Russian inflect the city name, so a template can never just
       append a suffix to `city`: "Երևան-ի" and "в Ереван" are both wrong. The
       inflected forms are stored, and templates interpolate those instead. */
    cityOf: "Երևանի",
    cityIn: "Երևանում",
    country: "Հայաստան",
  },

  filters: {
    location: "Տեղակայում",
    propertyType: "Գույքի տեսակ",
    price: "Գին",
    rooms: "Սենյակներ",
    allDistricts: "Ամբողջ Երևանը",
    intentAll: "Բոլորը",
    intentBuy: "Վաճառք",
    intentRent: "Վարձակալություն",
    intentLand: "Հողատարածք",
    showResults: "Դիտել արդյունքները",
    clear: "Մաքրել",
    openMenu: "Բացել ցանկը",
  },

  results: {
    empty: "Այս պայմաններին ոչինչ չի համապատասխանում։",
    emptyNote: "Ընդլայնեք գնային միջակայքը կամ ընտրեք այլ շրջան։",
    unavailable: "Հայտարարությունները ժամանակավորապես անհասանելի են։",
    unavailableNote: "Խնդրում ենք փորձել մի փոքր ուշ։",
  },

  /* Plural word forms used by the centralised formatter (lib/listings/format.ts).
     Armenian takes the singular after a numeral, so the three forms match. */
  units: {
    area: "քմ",
    properties: { one: "գույք", few: "գույք", many: "գույք" },
    rooms: { one: "սենյակ", few: "սենյակ", many: "սենյակ" },
    bedrooms: { one: "ննջասենյակ", few: "ննջասենյակ", many: "ննջասենյակ" },
    bathrooms: { one: "սանհանգույց", few: "սանհանգույց", many: "սանհանգույց" },
    photos: { one: "լուսանկար", few: "լուսանկար", many: "լուսանկար" },
    listed: { one: "հայտարարություն", few: "հայտարարություն", many: "հայտարարություն" },
  },

  /* Floor presentation. `floorOrdinal` is the compact metadata form; Armenian
     writes "1-ին" for the first floor and "N-րդ" for the rest, which the
     formatter selects between. `floorPair` is the detail page's fact value,
     replacing the mapper's English "5 of 9". */
  floor: {
    ordinalFirst: "{floor}-ին հարկ",
    ordinal: "{floor}-րդ հարկ",
    pair: "{floor} / {total}",
  },

  /** Price period suffixes, appended to the formatted amount. */
  period: {
    month: " / ամիս",
    day: " / օր",
    year: " / տարի",
  },

  property: {
    forSale: "Վաճառք",
    forRent: "Վարձակալություն",
    land: "Հողատարածք",
    negotiable: "Սակարկելի",
    type: "Տեսակ",
    rooms: "Սենյակներ",
    bedrooms: "Ննջասենյակներ",
    bathrooms: "Սանհանգույցներ",
    area: "Մակերես",
    landArea: "Հողատարածք",
    size: "Մակերես",
    floor: "Հարկ",
    built: "Կառուցված",
    features: "Հարմարություններ",
    location: "Տեղակայում",
    price: "Գին",
    gallery: "Պատկերասրահ",
    photographyToFollow: "Լուսանկարները՝ շուտով",
    breadcrumb: "Գույքեր",
    breadcrumbLabel: "Նավիգացիոն շղթա",
    more: "Ընտրանիի այլ առաջարկներ",
    all: "Բոլոր գույքերը",
    view: "Դիտել գույքը",
  },

  /** Database `property_type` codes. Frozen keys, translated display only. */
  propertyTypes: {
    apartment: "Բնակարան",
    penthouse: "Պենտհաուս",
    house: "Առանձնատուն",
    villa: "Վիլլա",
    townhouse: "Թաունհաուս",
    commercial: "Կոմերցիոն տարածք",
    office: "Գրասենյակ",
    retail: "Առևտրի տարածք",
    warehouse: "Պահեստ",
    land: "Հողատարածք",
    garage: "Ավտոտնակ",
    other: "Այլ",
  },

  /* Feature codes as extraction records them (snake_case). Unknown codes fall
     back to the label the mapper produced, so a new code is never dropped. */
  features: {
    air_conditioning: "Օդորակիչ",
    attic: "Ձեղնահարկ",
    balcony: "Պատշգամբ",
    basement: "Նկուղ",
    central_heating: "Կենտրոնական ջեռուցում",
    city_view: "Քաղաքի տեսարան",
    elevator: "Վերելակ",
    fireplace: "Բուխարի",
    floor_heating: "Տակհատակային ջեռուցում",
    furnished: "Կահավորված",
    garage: "Ավտոտնակ",
    garden: "Այգի",
    gas_heating: "Գազով ջեռուցում",
    mountain_view: "Լեռների տեսարան",
    new_building: "Նոր շենք",
    parking: "Ավտոկայանատեղի",
    pet_friendly: "Կենդանիների հետ թույլատրելի",
    playground: "Խաղահրապարակ",
    renovated: "Վերանորոգված",
    security: "Անվտանգության ծառայություն",
    storage: "Պահեստային տարածք",
    swimming_pool: "Լողավազան",
    terrace: "Տեռաս",
    unfurnished: "Չկահավորված",
  },

  contact: {
    enquire: "Հարցում",
    requestInfo: "Ստանալ մանրամասներ",
    leaveDetails: "Թողեք Ձեր տվյալները, և մենք կկապվենք Ձեզ հետ։",
    call: "Զանգել",
    whatsapp: "Գրել WhatsApp-ով",
    contact: "Կապ",
    agent: "Գործակալ",
    price: "Գին",
    speakToUs: "Խոսեք մեզ հետ",
    tellUs: "Պատմեք, թե ինչ եք փնտրում",
    notListed: "Չե՞ք գտնում այն, ինչ փնտրում եք։ Մենք առաջարկում ենք գույքեր մինչև հրապարակումը։",
    talkToTeam: "Խոսեք թիմի հետ",
    contactBrand: "Կապվել {brand}-ի հետ",
    contactUs: "Կապվել մեզ հետ",
    /* WhatsApp message bodies. The listing title, place and price are inserted
       exactly as the database stores / the formatter renders them. */
    whatsappGeneral: "Բարև {brand} — ցանկանում եմ խոսել գույքի մասին։",
    whatsappListing: "Բարև {brand} — ցանկանում եմ ավելին իմանալ «{name}» գույքի մասին ({place}), գինը՝ {price}։ Կոդ՝ {slug}",
    viber: "Գրել Viber-ով",
    openMap: "Բացել քարտեզում",
    visitUs: "Այցելեք մեզ",
    follow: "Հետևեք մեզ",
    callAgent: "Զանգել գործակալին",
    noAnswer: "Գործակալը չի՞ պատասխանում",
    callAgency: "Զանգել գործակալությանը",
  },

  lead: {
    title: "Վաճառո՞ւմ եք, թե՞ փնտրում եք բնակարան",
    body: "Գրեք կամ զանգեք մեզ, և մենք ամեն ինչ կկազմակերպենք պրոֆեսիոնալ մակարդակով։",
    call: "Զանգել",
    write: "Գրել WhatsApp-ով",
    close: "Փակել",
    whatsapp: "Բարև {brand} — ցանկանում եմ խորհրդակցել գույքի վաճառքի/գնման վերաբերյալ։",
  },

  services: {
    label: "Ծառայություններ",
    title: "Ինչով կարող ենք օգնել",
    items: [
      { title: "Վաճառել կամ վարձով տալ", text: "Կգնահատենք գույքը, կլուսանկարենք, կգտնենք վստահելի գնորդ կամ վարձակալ և կուղեկցենք մինչև գործարքի ավարտը։" },
      { title: "Գնել տուն", text: "Կընտրենք Ձեր պահանջներին համապատասխան տարբերակներ, կկազմակերպենք դիտումներ և կստուգենք փաստաթղթերը։" },
      { title: "Վարձակալել", text: "Կգտնենք հարմար բնակարան Ձեր բյուջեով և ժամկետներով՝ առանց ավելորդ ժամանակի կորստի։" },
    ],
    cta: "Կապվել մեզ հետ",
  },

  inquiry: {
    defaultMessage: "Ցանկանում եմ ավելի մանրամասն տեղեկություններ «{name}» գույքի մասին։",
    sentLabel: "Հարցումն ուղարկված է",
    sentTitle: "Շնորհակալություն։ Մենք շուտով կկապվենք Ձեզ հետ։",
    fieldName: "Անուն, ազգանուն",
    fieldPhone: "Հեռախոսահամար",
    fieldEmail: "Էլ. հասցե (ոչ պարտադիր)",
    fieldMessage: "Հաղորդագրություն",
    sending: "Ուղարկվում է…",
    send: "Ուղարկել հարցումը",
    privacy: "Այս տվյալները օգտագործում ենք միայն Ձեր հարցմանը պատասխանելու համար։",
    errName: "Խնդրում ենք նշել Ձեր անունը։",
    errPhone: "Խնդրում ենք նշել վավեր հեռախոսահամար։",
    errEmail: "Խնդրում ենք նշել վավեր էլ. հասցե կամ թողնել դաշտը դատարկ։",
    errMessage: "Խնդրում ենք հաղորդագրությունը պահել {max} նշանից կարճ։",
    /* Keyed by the machine-readable `error` code the API returns, so the
       visitor never sees the route's English `message`. */
    errUnavailable: "Այս պահին չհաջողվեց ուղարկել Ձեր հարցումը։ Խնդրում ենք փորձել կրկին կամ կապվել հեռախոսով կամ WhatsApp-ով։",
    errRateLimited: "Ձեր հարցումն արդեն ստացվել է։ Խնդրում ենք մի փոքր սպասել և փորձել կրկին։",
    errInvalid: "Խնդրում ենք ստուգել նշված դաշտերը։",
    errPropertyUnavailable: "Այս գույքն այլևս հասանելի չէ։ Խնդրում ենք ուղղակիորեն կապվել մեզ հետ։",
    errNetwork: "Չհաջողվեց ուղարկել հարցումը։ Ստուգեք կապը և փորձեք կրկին։",
  },

  gallery: {
    viewAll: "Դիտել բոլոր {count} լուսանկարները",
    open: "Բացել {index}-րդ լուսանկարը {total}-ից",
    prev: "Նախորդ",
    next: "Հաջորդ",
    close: "Փակել",
    of: "{name} — պատկերասրահ",
    /** Alt text of a listing photo that has no stored description. */
    imageAlt: "{name}, լուսանկար {index}",
  },

  /* Display title of a listing whose stored title was generated by the system
     (lib/listings/titles.ts). Built from the structured fields: the deal
     template wraps the subject, `withPlace` appends the localised place.
     `rooms` exists only for the residential types; every other type uses its
     `subject` noun alone. Lower-case nouns: they sit mid-sentence. */
  listingTitle: {
    sale: "Վաճառվում է {subject}",
    rent: "Վարձով է տրվում {subject}",
    withPlace: "{title}, {place}",
    rooms: {
      apartment: "{count} սենյականոց բնակարան",
      penthouse: "{count} սենյականոց պենտհաուս",
      house: "{count} սենյականոց առանձնատուն",
      villa: "{count} սենյականոց վիլլա",
      townhouse: "{count} սենյականոց թաունհաուս",
    },
    subject: {
      apartment: "բնակարան",
      penthouse: "պենտհաուս",
      house: "առանձնատուն",
      villa: "վիլլա",
      townhouse: "թաունհաուս",
      commercial: "կոմերցիոն տարածք",
      office: "գրասենյակ",
      retail: "առևտրի տարածք",
      warehouse: "պահեստ",
      land: "հողատարածք",
      garage: "ավտոտնակ",
      other: "գույք",
    },
  },

  page: {
    indexLabel: "Ընտրանի",
    indexTitle: "Ընտրեք Ձեր հաջորդ հասցեն։",
    indexMetaTitle: "Գույքեր",
    indexMetaDescription: "Բնակարաններ, առանձնատներ, հողատարածքներ և կոմերցիոն տարածքներ Երևանում։",
    notFoundMetaTitle: "Գույքը չի գտնվել",
    siteDescription: "Գտեք Ձեր տեղը։ Սկսեք Ձեր նոր գլուխը։ {cityOf} գույքեր՝ ընտրված Ձեր ապրելակերպի համար։",
    ogDescription: "{cityOf} գույքեր՝ ընտրված Ձեր ապրելակերպի համար։",
  },

  /* ------------------------------------------------------------------ homepage */

  hero: {
    // Two display lines, animated separately.
    headline: ["Ձեր նոր տունը", "սպասում է Ձեզ։"],
    /** The agency's blessing to its visitors, shown above the headline. */
    blessing: "Աստված օրհնի Ձեզ",
    copy: "Բնակարաններ, առանձնատներ և կոմերցիոն տարածքներ Երևանում՝ փորձառու գործակալների ընտրությամբ։",
    explore: "Դիտել գույքերը",
    scroll: "Ոլորեք՝ բացահայտելու",
  },

  search: {
    label: "Գույքի որոնում",
    title: ["Ի՞նչ եք", "փնտրում։"],
    submit: "Որոնել գույք",
    inPlace: "{intent} {cityIn}",
    searching: "Որոնում՝ {intent} · {city}",
    buyBlurb: "Բնակարաններ, առանձնատներ և պենտհաուսներ՝ երկարաժամկետ սեփականության համար։",
    rentBlurb: "Կահավորված և չկահավորված բնակարաններ՝ վեց և տասներկու ամսվա պայմաններով։",
    landBlurb: "Հողատարածքներ՝ թույլտվություններով, ենթակառուցվածքով և կառուցելու արժանի կողմնորոշմամբ։",
  },

  home: {
    latestLabel: "Վերջին առաջարկները",
    latestTitle: "Նոր հայտարարություններ",
  },

  selection: {
    label: "Ընտրանի",
    title: ["Ընտրեք Ձեր", "հաջորդ հասցեն։"],
    note: "Ներկայումս՝ {count}։",
    empty: "Այս պահին հայտարարություններ չկան։",
    shown: "Ցուցադրված է {shown} {total}-ից",
    seeAll: "Դիտել բոլոր գույքերը",
  },

  transformation: {
    label: "Փոխակերպում",
    title: ["Տարածքից՝", "հնարավորություն։"],
    lead: "Տեսեք, թե ինչ է հնարավոր։",
    stages: ["Դատարկ տարածք", "Կառուցվածք", "Նյութեր", "Կահույք", "Լույս", "Տուն"],
    hint: "Ոլորեք՝ տարածքով անցնելու համար · ոլորեք հետ՝ հակառակ ուղղությամբ",
  },

  collection: {
    label: "Կատեգորիաներ",
    title: "VIP ընտրանին",
    scrollHint: "Ոլորեք՝ առաջ շարժվելու →",
    explore: "Դիտել",
  },

  about: {
    label: "{brand}-ի մասին",
    headline: ["Ավելին, քան գույքը։", "Դեպի տուն՝ ավելի ճիշտ ճանապարհով։"],
    /* The agency's own text (chosen by the founder, 2026-11). */
    body: [
      "{brand}-ն 2022 թվականից աշխատում է Երևանի և մոտակա քաղաքների անշարժ գույքի շուկայում։ Այս ընթացքում օգնել ենք 1000-ից ավելի ընտանիքների գտնել իրենց տունը կամ վաճառել իրենց գույքը։ Մեր թիմը լավ գիտի քաղաքի յուրաքանչյուր թաղամաս և յուրաքանչյուր հաճախորդի հետ աշխատում է անհատապես՝ առաջին զանգից մինչև գործարքի ավարտը։",
      "Գործակալության հիմնադիր-տնօրենը Սերգեյ Միխայելյանն է, իսկ աշխատակազմը ղեկավարում է Ջեմմա Մելքոնյանը։ Մեր 7 հոգանոց թիմը կօգնի Ձեզ գործարքի յուրաքանչյուր քայլում։",
    ],
    /** Under the logo on the brand panel — the logo's own line. */
    panelTagline: "Ձեր անշարժ գույքի գործակալությունը",
    statClients: "Հաճախորդ",
    statFounded: "Հիմնադրման տարի",
  },

  /* Faith section. The verse and the statement are proposals awaiting the
     founder's confirmation of the exact wording. */
  faith: {
    label: "Մեր հավատքը",
    verse: "Եթե Տերը չշինի տունը, իզուր են աշխատում նրա շինողները։",
    reference: "Սաղմոս 127:1",
    statement: "Մենք հավատացյալ ընտանիք ենք և մեր գործը կառուցում ենք ազնվության ու Աստծո օրհնության վրա։ Յուրաքանչյուր տուն, որ օգնում ենք գտնել, ինչ-որ մեկի նոր կյանքի սկիզբն է։",
    founders: "Սերգեյ Միխայելյան և Ջեմմա Մելքոնյան",
    foundersRole: "Հիմնադիր-տնօրեն · Աշխատակազմի ղեկավար",
    photoAlt: "Սերգեյ Միխայելյանը և Ջեմմա Մելքոնյանը",
  },

  map: {
    label: "Շրջաններ",
    title: ["Գտեք Ձեր տեղը", "Երևանում։"],
    note: "Երևանի 12 շրջանները՝ իրական քարտեզի վրա։ Ընտրեք շրջանը՝ տեսնելու հասանելի տարբերակները։",
    all: "Ամբողջ Երևանը",
    available: "{count} հասանելի",
    empty: "Այս պահին այստեղ հայտարարություններ չկան։ Փորձեք այլ շրջան։",
    alt: "Երևանի քարտեզ շրջաններով",
    districtCount: "{district}, {count} գույք",
  },

  /** The twelve Yerevan districts (lib/listings/places.ts). Ids are frozen; only
   *  these display labels change. The first five are also drawn on the map. */
  districts: {
    kentron: "Կենտրոն",
    arabkir: "Արաբկիր",
    davtashen: "Դավթաշեն",
    ajapnyak: "Աջափնյակ",
    avan: "Ավան",
    erebuni: "Էրեբունի",
    "kanaker-zeytun": "Քանաքեռ-Զեյթուն",
    "malatia-sebastia": "Մալաթիա-Սեբաստիա",
    "nor-nork": "Նոր Նորք",
    "nork-marash": "Նորք-Մարաշ",
    nubarashen: "Նուբարաշեն",
    shengavit: "Շենգավիթ",
  },

  /** Recognised city names (lib/listings/places.ts). */
  cities: {
    yerevan: "Երևան",
  },

  districtBlurbs: {
    kentron: "Քաղաքի սիրտը։ Օպերան, Հյուսիսային պողոտան, երբեք չփակվող սրճարանները։",
    arabkir: "Կայացած, կանաչ, հանգիստ բնակելի։ Երկար փողոցներ և հին ծառեր։",
    davtashen: "Բաց երկինք և նոր կառուցապատում։ Ընտանիքներ, տարածք, շրջանցիկ ճանապարհը մոտ։",
    ajapnyak: "Ձորի արևմուտքում։ Լայն տեսարաններ դեպի քաղաք և Արարատ։",
    avan: "Բարձրադիր և հանգիստ, հյուսիս-արևելյան եզրին։ Օդ և հեռավորություն։",
    "kanaker-zeytun": "Կենտրոնին մոտ, բարձունքի վրա։ Զարգացած ենթակառուցվածքներ և տեսարան դեպի քաղաք։",
    "nor-nork": "Մեծ և կանաչ բնակելի շրջան։ Դպրոցներ, խանութներ, ընտանիքների համար հարմար։",
    "nork-marash": "Փոքր, հանգիստ և կենտրոնին շատ մոտ։ Առանձնատներ և կանաչ բակեր։",
    "malatia-sebastia": "Քաղաքի արևմուտքում։ Մատչելի գներ, լայն պողոտաներ և շուկաներ։",
    "shengavit": "Հարավ-արևմուտքում, լճի մոտ։ Մետրո, նոր նախագծեր և լավ կապ կենտրոնի հետ։",
    "erebuni": "Քաղաքի ամենահին մասը։ Լայն տարածքներ, առանձնատներ և օդանավակայանի մոտ։",
    "nubarashen": "Հարավային եզրին։ Հանգիստ, տարածք և առանձնատների հողամասեր։",
  },

  featured: {
    label: "Ընտրված գույք",
    alt: "{name} — ընտրված գույք",
  },

  cta: {
    eyebrow: "Մենք Ձեզ հետ ենք ամեն քայլում",
    title: "Եկեք միասին գտնենք Ձեր հաջորդ հասցեն։",
  },

  footer: {
    properties: "Գույքեր",
    neighbourhoods: "Շրջաններ",
    contact: "Կապ",
    beingSetUp: "Կոնտակտային տվյալները լրացվում են։",
    blurb: "{concept}։ {cityOf} գույքեր՝ ընտրված Ձեր ապրելակերպի համար։",
  },

  common: {
    loading: "Բեռնվում է…",
    back: "Վերադառնալ",
    backHome: "Վերադառնալ գլխավոր էջ",
    notFound: "Էջը չի գտնվել։",
    error: "Ինչ-որ բան այն չէ։",
    errorLabel: "Ժամանակավորապես անհասանելի",
    tryAgain: "Փորձել կրկին",
  },

  taxonomy: {
    types: {
      any: "Ցանկացած տեսակ",
      apartments: "Բնակարան",
      houses: "Առանձնատուն",
      land: "Հողատարածք",
      commercial: "Կոմերցիոն",
    },
    price: {
      any: "Ցանկացած գին",
      "0-150": "Մինչև $150,000",
      "150-300": "$150,000 – $300,000",
      "300-600": "$300,000 – $600,000",
      "600+": "$600,000-ից ավելի",
    },
    rooms: {
      any: "Ցանկացած",
      "1": "1 +",
      "2": "2 +",
      "3": "3 +",
      "4": "4 +",
    },
    categories: {
      apartments: "Բնակարաններ",
      houses: "Առանձնատներ",
      land: "Հողատարածքներ",
      commercial: "Կոմերցիոն",
    },
    categoryBlurbs: {
      apartments: "Քաղաքային բնակարաններ՝ երկու կողմից լույսով, հին քարից մինչև նոր աշտարակներ։",
      houses: "Առանձնատներ, պատշգամբներ և այգիներ՝ կենտրոնից ոչ հեռու։",
      land: "Հողատարածքներ՝ թույլտվություններով, ճիշտ կողմնորոշմամբ և կառուցելու արժանի տեսարանով։",
      commercial: "Առաջին հարկեր, ստուդիաներ և գրասենյակներ՝ իրական մարդաշատ փողոցներում։",
    },
  },
};
