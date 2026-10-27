/* EnaGIS live engine configuration.
 * Every default here is a SCREENING assumption unless a source is named. Nothing in this file is
 * human-approved for scientific use; the interface says so and lets the user change values.
 * Ranges are [low, central, high]. Sampling uses a triangular distribution over them.
 */
function enaConfigFactory() {
  "use strict";

  const COUNTRIES = {
    RW: {
      id: "RW",
      name: "Rwanda",
      population: {value: 13246394, source: "NISR, 5th Population and Housing Census, Aug 2022",
        url: "https://statistics.gov.rw/publication/Rwanda_population_2022"},
      // Persons per mapped building: assumption. Not all buildings are homes; the range carries that.
      persons_per_building: {range: [2.5, 4.0, 5.0], label: "INFERRED",
        note: "Assumption: mapped buildings x persons per building. Confirm against census households."},
      commodities: {
        irish_potato: {annual_t: 827355, year: 2024, label: "OBSERVED",
          source: "NISR Seasonal Agricultural Survey 2024, annual report, Table 0 (Season A 460,830 + B 285,596 + C 80,929 t)",
          url: "https://statistics.gov.rw/sites/default/files/documents/2025-02/SAS%202024%20Annual.pdf"},
        maize: {annual_t: 627086, year: 2024, label: "OBSERVED",
          source: "NISR Seasonal Agricultural Survey 2024, annual report, Table 0 (Season A 507,985 + B 119,101 t)",
          url: "https://statistics.gov.rw/sites/default/files/documents/2025-02/SAS%202024%20Annual.pdf"},
        milk: {annual_t: 1000000, year: 2023, label: "OBSERVED",
          source: "MINAGRI via The New Times: 'more than one million tonnes (one billion litres) in 2023'",
          url: "https://www.newtimes.co.rw/article/14060/news/economy/rwandas-milk-production-exceeds-one-million-tonnes"}
      },
      /* District production, 2024 (ESTIMATED). Each district's share of Season A production (NISR SAS 2024 Season A,
       * Table 9 cultivated area x Table 11 yield; reproduces the national Season A totals within 0.5% for potato and
       * 2.4% for maize) applied to the national 2024 annual total. Population: 2022 census. Kirehe, Ngoma and Bugesera
       * yields are not legible in the source and use the area-weighted mean of the other Eastern districts.
       * Table: data/rwanda/district_production_2024.csv. Milk has no district series yet: national average. */
      district_source: {label: "ESTIMATED", url: "https://statistics.gov.rw/sites/default/files/documents/2024-10/SAS_2024%20Season%20A%20Final%20Report%20%282%29_compressed.pdf",
        source: "NISR Seasonal Agricultural Survey 2024 (Season A area x yield by district, scaled to the 2024 national total); NISR 2022 census population"},
      districts: {
        Nyarugenge: {province: "Kigali", population: 374319, irish_potato: 328, maize: 1254},
        Gasabo: {province: "Kigali", population: 879505, irish_potato: 5330, maize: 7168},
        Kicukiro: {province: "Kigali", population: 491731, irish_potato: 117, maize: 2402},
        Nyanza: {province: "South", population: 365718, irish_potato: 2668, maize: 13650},
        Gisagara: {province: "South", population: 397051, irish_potato: 1364, maize: 16223},
        Nyaruguru: {province: "South", population: 318126, irish_potato: 19800, maize: 10114},
        Huye: {province: "South", population: 381900, irish_potato: 3740, maize: 10610},
        Nyamagabe: {province: "South", population: 371501, irish_potato: 43445, maize: 12152},
        Ruhango: {province: "South", population: 359121, irish_potato: 715, maize: 8126},
        Muhanga: {province: "South", population: 358433, irish_potato: 2663, maize: 4698},
        Kamonyi: {province: "South", population: 450849, irish_potato: 3293, maize: 13080},
        Karongi: {province: "West", population: 373869, irish_potato: 8216, maize: 13662},
        Rutsiro: {province: "West", population: 369180, irish_potato: 45480, maize: 9832},
        Rubavu: {province: "West", population: 546683, irish_potato: 145191, maize: 5161},
        Nyabihu: {province: "West", population: 319047, irish_potato: 184486, maize: 6800},
        Ngororero: {province: "West", population: 367955, irish_potato: 20000, maize: 7096},
        Rusizi: {province: "West", population: 485529, irish_potato: 2553, maize: 17661},
        Nyamasheke: {province: "West", population: 434221, irish_potato: 0, maize: 11150},
        Rulindo: {province: "North", population: 360144, irish_potato: 14552, maize: 11540},
        Gakenke: {province: "North", population: 365292, irish_potato: 13516, maize: 20357},
        Musanze: {province: "North", population: 476522, irish_potato: 86188, maize: 13069},
        Burera: {province: "North", population: 387729, irish_potato: 90082, maize: 23961},
        Gicumbi: {province: "North", population: 448824, irish_potato: 51605, maize: 12424},
        Rwamagana: {province: "East", population: 484953, irish_potato: 12270, maize: 22505},
        Nyagatare: {province: "East", population: 653861, irish_potato: 6938, maize: 116221},
        Gatsibo: {province: "East", population: 551164, irish_potato: 21679, maize: 52707},
        Kayonza: {province: "East", population: 457156, irish_potato: 13125, maize: 40880},
        Kirehe: {province: "East", population: 460860, irish_potato: 12680, maize: 70503, imputed: true},
        Ngoma: {province: "East", population: 404048, irish_potato: 12672, maize: 44903, imputed: true},
        Bugesera: {province: "East", population: 551103, irish_potato: 2661, maize: 27176, imputed: true}
      },
    }
  };

  // Countries without a pack: the engine still maps sites, roads, grid and climate, but production
  // per person is UNKNOWN until the user enters it. It never borrows Rwanda's numbers silently.
  const GENERIC_COUNTRY = {
    id: "XX", name: "Unconfigured country", population: null,
    persons_per_building: {range: [2.5, 4.0, 5.0], label: "INFERRED",
      note: "Assumption: mapped buildings x persons per building."},
    commodities: {}
  };

  /* Site types. capture: relative share of catchment volume a site of this type is assumed to
   * handle (multiplies the model's capture share). Assumptions, sampled in the simulation. */
  const SITE_TYPES = {
    milk_centre:   {label: "Milk collection centre", short: "Milk centre", documented: true},
    coffee_station:{label: "Coffee washing station", short: "Coffee station", documented: true},
    cold_store:    {label: "Cold store", short: "Cold store", documented: true},
    mill:          {label: "Mill", short: "Mill", documented: true},
    cooperative:   {label: "Cooperative", short: "Cooperative", documented: true},
    warehouse:     {label: "Warehouse / store", short: "Warehouse", documented: true},
    market:        {label: "Market", short: "Market", documented: true},
    agro_factory:  {label: "Agro-processing works", short: "Processing", documented: true},
    tea_factory:   {label: "Tea factory", short: "Tea factory", documented: true},
    agro_shop:     {label: "Agro-input / farm shop", short: "Farm shop", documented: true},
    town:          {label: "Town centre (no facility mapped)", short: "Town", documented: false},
    village:       {label: "Village centre (no facility mapped)", short: "Village", documented: false}
  };

  const p = (low, central, high, unit, label, note) => ({range: [low, central, high], unit, label, note});

  const MODELS = {
    potato_storage: {
      id: "potato_storage",
      name: "Cold storage · Irish potato",
      short: "Potato cold storage",
      commodity: "irish_potato",
      unit_out: "kWh/day",
      service: "Refrigerated storage after harvest",
      question_volume: "How many tonnes of potatoes arrive here in the busiest harvest month, and how long are they kept?",
      types: {cold_store: [0.8, 1.0, 1.2], cooperative: [0.6, 0.9, 1.1], warehouse: [0.4, 0.7, 1.0],
        market: [0.3, 0.6, 0.9], agro_factory: [0.4, 0.7, 1.0], agro_shop: [0.1, 0.3, 0.5],
        town: [0.2, 0.4, 0.7], village: [0.1, 0.3, 0.5]},
      params: {
        capture_share: p(0.05, 0.15, 0.30, "fraction", "INFERRED", "Share of catchment harvest that passes through one aggregation site"),
        peak_month_fraction: p(0.12, 0.20, 0.30, "fraction", "INFERRED", "Share of the annual volume that arrives in the busiest month (two seasons a year)"),
        storage_days: p(14, 30, 60, "day", "INFERRED", "Days produce stays in store"),
        store_temp_c: p(4, 7, 10, "°C", "INFERRED", "Table potatoes 7-10 °C, seed potatoes 2-4 °C"),
        cp_kj_per_kg_k: p(3.4, 3.6, 3.8, "kJ/kg·K", "ESTIMATED", "Specific heat of potato"),
        holding_kwh_th_per_t_day: p(0.10, 0.20, 0.40, "kWh(th)/t·day", "INFERRED", "Respiration + walls + door openings"),
        cop: p(1.5, 2.2, 3.0, "ratio", "INFERRED", "Refrigeration coefficient of performance"),
        run_hours: p(14, 16, 20, "h/day", "INFERRED", "Compressor running hours per day")
      },
      compute(a, q, ambient) {
        const intake = a * q.peak_month_fraction / 30; // t/day at peak
        const stored = intake * q.storage_days;
        const dT = Math.max(0, ambient - q.store_temp_c);
        const pull = intake * 1000 * q.cp_kj_per_kg_k * dT / 3600;
        const hold = stored * q.holding_kwh_th_per_t_day;
        const kwh = (pull + hold) / q.cop;
        return {kwh_day: kwh, kw: kwh / q.run_hours, throughput_t_day: intake, stored_t: stored};
      }
    },
    milk_cooling: {
      id: "milk_cooling",
      name: "Cooling · Milk collection",
      short: "Milk cooling",
      commodity: "milk",
      unit_out: "kWh/day",
      service: "Chilling raw milk at collection",
      question_volume: "How many litres are delivered here on a peak rainy-season day, and is milk already chilled?",
      types: {milk_centre: [0.8, 1.0, 1.2], cooperative: [0.5, 0.8, 1.0], agro_factory: [0.4, 0.7, 1.0],
        market: [0.1, 0.3, 0.5], town: [0.2, 0.4, 0.6], village: [0.2, 0.4, 0.6]},
      params: {
        capture_share: p(0.15, 0.30, 0.50, "fraction", "INFERRED", "Share of catchment milk delivered to formal collection"),
        peak_factor: p(1.05, 1.25, 1.45, "ratio", "INFERRED", "Rainy-season peak day relative to average day"),
        milk_in_c: p(28, 32, 36, "°C", "INFERRED", "Milk temperature on arrival"),
        milk_out_c: p(4, 4, 6, "°C", "INFERRED", "Target storage temperature"),
        cp_kj_per_kg_k: p(3.85, 3.93, 3.98, "kJ/kg·K", "ESTIMATED", "Specific heat of milk"),
        holding_fraction: p(0.05, 0.10, 0.20, "fraction", "INFERRED", "Holding losses as a share of pull-down energy"),
        cop: p(1.8, 2.5, 3.2, "ratio", "INFERRED", "Bulk cooler coefficient of performance"),
        run_hours: p(8, 10, 14, "h/day", "INFERRED", "Cooler running hours per day")
      },
      compute(a, q) {
        const kgDay = a * 1000 / 365 * q.peak_factor;
        const th = kgDay * q.cp_kj_per_kg_k * Math.max(0, q.milk_in_c - q.milk_out_c) / 3600 * (1 + q.holding_fraction);
        const kwh = th / q.cop;
        return {kwh_day: kwh, kw: kwh / q.run_hours, throughput_t_day: kgDay / 1000, litres_day: kgDay / 1.03};
      }
    },
    maize_milling: {
      id: "maize_milling",
      name: "Milling · Maize",
      short: "Maize milling",
      commodity: "maize",
      unit_out: "kWh/day",
      service: "Hammer or roller milling into flour",
      question_volume: "How many tonnes of maize are milled here on a normal day, and what powers the mill now?",
      types: {mill: [0.8, 1.0, 1.2], cooperative: [0.4, 0.7, 1.0], market: [0.4, 0.7, 1.0],
        warehouse: [0.3, 0.5, 0.8], agro_factory: [0.6, 0.9, 1.1], town: [0.3, 0.6, 0.9], village: [0.2, 0.4, 0.6]},
      params: {
        capture_share: p(0.10, 0.25, 0.45, "fraction", "INFERRED", "Share of catchment maize milled at one site"),
        operating_days: p(250, 300, 330, "day/yr", "INFERRED", "Milling days per year"),
        specific_energy: p(15, 25, 40, "kWh/t", "ESTIMATED", "Electricity per tonne milled (hammer mills, literature range)"),
        run_hours: p(6, 8, 10, "h/day", "INFERRED", "Mill running hours per day")
      },
      compute(a, q) {
        const tDay = a / q.operating_days;
        const kwh = tDay * q.specific_energy;
        return {kwh_day: kwh, kw: kwh / q.run_hours, throughput_t_day: tDay};
      }
    },
    maize_drying: {
      id: "maize_drying",
      name: "Drying · Maize (fans and handling)",
      short: "Maize drying",
      commodity: "maize",
      unit_out: "kWh/day",
      service: "Mechanical drying after harvest (electric fans and handling; heat from other fuels)",
      question_volume: "How many tonnes of wet maize arrive per day at harvest, and how is it dried today?",
      types: {cooperative: [0.6, 0.9, 1.1], warehouse: [0.5, 0.8, 1.0], mill: [0.3, 0.6, 0.9],
        agro_factory: [0.5, 0.8, 1.0], market: [0.2, 0.4, 0.6], town: [0.2, 0.4, 0.6], village: [0.1, 0.3, 0.5]},
      params: {
        capture_share: p(0.05, 0.15, 0.30, "fraction", "INFERRED", "Share of catchment maize dried mechanically at one site"),
        harvest_window_days: p(45, 60, 90, "day", "INFERRED", "Days over which one season's harvest arrives"),
        seasons_per_year: p(1, 2, 2, "count", "INFERRED", "Maize seasons per year (A and B)"),
        specific_energy: p(4, 8, 15, "kWh/t", "ESTIMATED", "Fan and handling electricity per tonne dried"),
        run_hours: p(10, 12, 16, "h/day", "INFERRED", "Dryer running hours per day")
      },
      compute(a, q) {
        const tDay = a / Math.max(1, Math.round(q.seasons_per_year)) / q.harvest_window_days;
        const kwh = tDay * q.specific_energy;
        return {kwh_day: kwh, kw: kwh / q.run_hours, throughput_t_day: tDay};
      }
    }
  };

  // Shared assumptions used by every model.
  const SHARED = {
    max_travel_min: p(60, 90, 120, "min", "INFERRED", "Longest trip a farmer makes to deliver produce"),
    urban_producer_weight: p(0.05, 0.15, 0.30, "fraction", "INFERRED", "Production weight of people in dense built-up cells"),
    local_variation_sd: p(0.2, 0.35, 0.5, "log-sd", "INFERRED", "How far local production per person can differ from the district (or national) average"),
    pv_performance_ratio: p(0.65, 0.75, 0.8, "ratio", "ESTIMATED", "Solar PV system performance ratio")
  };

  // km/h. Rain factors multiply dry speed. Assumptions; surface tags refine them.
  const SPEEDS = {
    motorway: 70, trunk: 60, primary: 50, secondary: 40, tertiary: 30, unclassified: 25, road: 20,
    residential: 20, living_street: 10, service: 15, track: 15, path: 5, footway: 5, bridleway: 5, steps: 3,
    motorway_link: 40, trunk_link: 40, primary_link: 35, secondary_link: 30, tertiary_link: 25
  };
  const PAVED = /^(paved|asphalt|concrete|concrete:plates|paving_stones|sett|chipseal|metal)$/;
  const LOOSE = /^(unpaved|dirt|earth|ground|mud|grass|sand|soil|clay|woodchips)$/;
  const FIRM = /^(gravel|fine_gravel|compacted|pebblestone|rock)$/;
  const MAJOR = /^(motorway|trunk|primary|secondary)(_link)?$/;
  function rainFactor(highway, surface) {
    if (surface && PAVED.test(surface)) return 0.9;
    if (surface && FIRM.test(surface)) return 0.7;
    if (surface && LOOSE.test(surface)) return 0.45;
    if (MAJOR.test(highway)) return 0.85; // untagged major road: assume mostly paved
    if (/^(track|path|footway|bridleway)$/.test(highway)) return 0.45;
    return 0.6; // untagged minor road: unknown surface
  }

  // Name patterns (English, French, Kinyarwanda) for facility detection in OSM.
  const NAME_PATTERNS = {
    milk_centre: /(milk|\bamata\b|\bmcc\b|collection cent|dairy|laiterie|laitier)/i,
    coffee_station: /(washing station|\bcws\b|coffee|café|ikawa)/i,
    cold_store: /(cold\s?(room|store|storage|chain)|frigo|chambre froide)/i,
    mill: /(\bmill(s|ing|ers?)?\b|minoterie|moulin|flour|kawunga)/i,
    cooperative: /(cooperative|coopérative|cooperativ|koperative|\bcoop\b|\bco-op\b)/i,
    warehouse: /(warehouse|entrep[oô]t|stock|ububiko|post.?harvest)/i,
    market: /(market|march[eé]|isoko)/i,
    // Words that make a generic works / warehouse plausibly agricultural.
    agri: /(maize|corn|grain|flour|food|agro|agri|farm|potato|milk|dairy|coffee|\btea\b|ibigori|ibirayi|amata|cassava|rice|beans|feed|fruit|vegetable|harvest|seed|fertili[sz]er|cooperative|koperative)/i
  };

  /* Overture Maps (overturemaps.org): monthly open map release. Buildings merge OpenStreetMap,
   * Google Open Buildings and Microsoft ML footprints, so rural homes missing from OSM are counted.
   * Read tile by tile from the public PMTiles archives (HTTP range requests, no server, no key). */
  const OVERTURE = {
    tiles: "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/",
    // Equivalent addresses of the same public bucket: spreading tiles over them lets the browser open more
    // connections at once (about 30% faster from Kigali in Oct 2026).
    mirrors: ["https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/",
      "https://overturemaps-extras-us-west-2.s3.amazonaws.com/tiles/",
      "https://s3.us-west-2.amazonaws.com/overturemaps-extras-us-west-2/tiles/",
      "https://overturemaps-extras-us-west-2.s3.dualstack.us-west-2.amazonaws.com/tiles/"],
    catalog: "https://stac.overturemaps.org/catalog.json",
    fallback_release: "2026-09-23.1",
    // The release the siting model was trained on (Phase 4R). Used first so results are reproducible; if it is ever
    // withdrawn from the bucket, the app switches to the latest release automatically.
    pinned_release: "2026-09-23.1",
    zoom: 14, base_zoom: 13, concurrency: 16, max_tiles: 650,
    // Overture road class -> OSM highway value used by SPEEDS and rainFactor.
    road_class: {motorway: "motorway", trunk: "trunk", primary: "primary", secondary: "secondary", tertiary: "tertiary",
      residential: "residential", living_street: "living_street", unclassified: "unclassified", service: "service",
      pedestrian: "footway", footway: "footway", sidewalk: "footway", crosswalk: "footway", steps: "steps", path: "path",
      track: "track", cycleway: "path", bridleway: "bridleway", unknown: "road"}
  };
  /* Overture places (Meta and Microsoft listings) are noisy. Only agricultural categories, or names that
   * clearly say cooperative / milk / mill / cold store, become candidate sites; offices, shops and
   * venues are excluded even when their name contains "market". */
  const PLACE_RULES = {
    min_confidence: 0.5,
    // Listings whose name says they are something else (a church called "Isoko ...", a minimarket).
    name_exclude: /(church|eglise|église|mosque|parish|paroisse|chapel|temple|ministr|minimarket|mini.?market|supermarket|super market|marketing|h[oô]tel|lodge|restaurant|bar\b|coffee ?shop|school|[eé]cole|education|consult|agency|hospital|clinic|pharmac|salon|boutique|bank|insurance|club|campus|universit|college|institute|tourism|football|\bf\.?c\.?(\s|$)|sports?\b|toilet|ubwiherero|latrine|parking)/i,
    // Generic categories only count when the name also says agriculture.
    needs_agri_name: ["warehouse", "agro_factory"],
    category: [
      [/^(farmers_market|public_market|market|flea_market|food_market)$/, "market"],
      [/(agricultural_cooperative|farming_cooperative|cooperative)/, "cooperative"],
      [/(dairy|milk)/, "milk_centre"],
      [/(flour_mill|grain_mill|rice_mill|mill$|milling)/, "mill"],
      [/(cold_storage|refrigerat)/, "cold_store"],
      [/^(warehouses?|storage_facility|grain_elevator|silo|agricultural_storage)$/, "warehouse"],
      [/tea_manufactur/, "tea_factory"],
      [/(food_processing|food_manufactur|agricultural_production|food_and_beverage_manufactur|beverage_manufactur)/, "agro_factory"],
      [/(agricultural_service|agricultural_supply|farm_equipment|seed|fertilizer|feed_store|agricultural)/, "agro_shop"]
    ],
    exclude: /(government|religious|marketing|printing|consult|professional|computer|software|media|agency|technology|bank|financial|hotel|lodging|restaurant|coffee_shop|cafe|bar$|church|worship|school|education|hospital|clinic|pharmacy|salon|beauty|fashion|apparel|electronics|phone|real_estate|travel|insurance|supermarket|department_store|grocery|convenience|fish_farm|farm$|ranch)/
  };

  return {COUNTRIES, GENERIC_COUNTRY, SITE_TYPES, MODELS, SHARED, SPEEDS, rainFactor, NAME_PATTERNS, OVERTURE, PLACE_RULES,
    // Public Overpass servers that answer browsers (CORS) and were reachable from Kigali in Oct 2026.
    OVERPASS: ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"],
    NOMINATIM: "https://nominatim.openstreetmap.org",
    OPEN_METEO_ARCHIVE: "https://archive-api.open-meteo.com/v1/archive",
    // WorldPop global population, 2020 (unconstrained, 100 m), summed over the boundary by WorldPop's API.
    WORLDPOP: {api: "https://api.worldpop.org/v1/services/stats", dataset: "wpgppop", year: 2020},
    MAX_AREA_KM2: 2500,
    TOP_K: 10,
    DRAWS: 300};
}
(function (root) {
  root.enaConfigFactory = enaConfigFactory;
  root.EnaConfig = enaConfigFactory();
  if (typeof module !== "undefined") module.exports = root.EnaConfig;
})(typeof window !== "undefined" ? window : globalThis);
