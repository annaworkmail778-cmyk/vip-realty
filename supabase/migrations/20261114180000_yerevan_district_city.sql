-- A listing that names only a Yerevan district ("Արաբկիրում") is in Yerevan. The demo normalization already derived
-- city=Yerevan when the model left the city empty, but when the model itself wrote city=Yerevan with the district as
-- evidence, the city-evidence check removed it again and the listing became "incomplete" (no draft, no Telegram card).
-- Changes: district names are normalized (case, spaces/underscores -> '-'), the 'nubarak' typo is fixed to
-- 'nubarashen', and city=Yerevan backed by a Yerevan district is no longer removed. Everything else is unchanged.

create or replace function public.validate_property_extraction(p_output jsonb, p_input jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
declare
  c_critical           constant text[] := array['intent', 'property_type', 'city', 'price', 'currency'];
  c_intent_terms       constant text := '(sale|sell|buy|purchase|rent|rental|lease|\mlet\M|продаж|прода[её]|купить|аренд|сда[её]т|сдаю|сдам|сдается|сдаётся|վաճառ|վարձ|գնել|prodaj|prodazh|arend|sdaet|sdayu|vachar|vardz)';
  c_armenia_terms      constant text := '(armenia|հայաստան|армени|\mհհ\M|\mра\M|\mra\M)';
  c_correction_terms   constant text := '(actually|correction|corrected|sorry|instead|mistake|update|changed|not [^,.]{1,30} but|исправ|точнее|на самом деле|вместо|ошиб|ուղղ|ճիշտ|փոխարեն|ոչ թե|սխալ)';
  c_yerevan_districts  constant text[] := array['ajapnyak','arabkir','avan','davtashen','erebuni','kanaker-zeytun',
                                                'kentron','malatia-sebastia','nor-nork','nork-marash','nubarashen','shengavit'];
  c_city_aliases       constant jsonb := '{
    "yerevan": "(yerevan|erevan|երևան|երեւան|ереван)",
    "gyumri": "(gyumri|gumri|գյումրի|гюмри)",
    "vanadzor": "(vanadzor|վանաձոր|ванадзор)",
    "dilijan": "(dilijan|դիլիջան|дилижан)",
    "abovyan": "(abovyan|աբովյան|абовян)",
    "tsaghkadzor": "(tsaghkadzor|ծաղկաձոր|цахкадзор)",
    "sevan": "(sevan|սևան|սեւան|севан)",
    "vagharshapat": "(vagharshapat|ejmiatsin|etchmiadzin|վաղարշապատ|էջմիածին|эчмиадзин|вагаршапат)",
    "hrazdan": "(hrazdan|հրազդան|раздан|hrazdan)",
    "ashtarak": "(ashtarak|աշտարակ|аштарак)",
    "artashat": "(artashat|արտաշատ|арташат)",
    "armavir": "(armavir|արմավիր|армавир)",
    "kapan": "(kapan|կապան|капан)",
    "goris": "(goris|գորիս|горис)",
    "jermuk": "(jermuk|ջերմուկ|джермук)"
  }'::jsonb;
  v_city     text;
  v_pattern  text;
  v_result   jsonb;
  v_status   text;
  v_issues   jsonb;
  v_property jsonb;
  v_conflict jsonb;
  v_last     integer;
  v_name     text;
  v_forced   boolean := false;
  v_yerevan_district boolean;
begin
  v_result := validate_property_extraction_structure(p_output, p_input);
  v_status := v_result ->> 'status';
  if v_status = 'invalid' then
    return v_result;
  end if;

  v_issues   := v_result -> 'issues';
  v_property := v_result -> 'property';

  v_yerevan_district := regexp_replace(lower(btrim(coalesce(v_property ->> 'district', ''))), '[\s_]+', '-', 'g')
                        = any(c_yerevan_districts);

  -- VIP demo deterministic normalization:
  -- a validated known Yerevan district establishes city=Yerevan.
  if not v_property ? 'city' and v_yerevan_district then
    v_property := v_property || jsonb_build_object('city', 'Yerevan');

    v_issues := coalesce((
      select jsonb_agg(i)
      from jsonb_array_elements(v_issues) i
      where not (
        i ->> 'code' = 'missing_critical_field'
        and i ->> 'field' = 'city'
      )
    ), '[]'::jsonb);
  end if;

  -- A validated floor/total_floors pair establishes apartment for this demo lane.
  if not v_property ? 'property_type'
     and v_property ? 'floor'
     and v_property ? 'total_floors'
  then
    v_property := v_property || jsonb_build_object('property_type', 'apartment');

    v_issues := coalesce((
      select jsonb_agg(i)
      from jsonb_array_elements(v_issues) i
      where not (
        i ->> 'code' = 'missing_critical_field'
        and i ->> 'field' = 'property_type'
      )
    ), '[]'::jsonb);
  end if;

  if v_property ? 'intent'
     and extraction_evidence_text(p_output -> 'fields' -> 'intent' ->> 'evidence') !~ c_intent_terms then
    v_property := v_property - 'intent';
    v_issues := v_issues || extraction_issue('warning', 'unsupported_value_removed', 'intent',
                                             'intent evidence contains no sale or rent term');
  end if;

  if v_property ->> 'country' = 'AM'
     and extraction_evidence_text(p_output -> 'fields' -> 'country' ->> 'evidence') !~ c_armenia_terms then
    v_property := v_property - 'country';
    v_issues := v_issues || extraction_issue('warning', 'unsupported_value_removed', 'country',
                                             'country evidence does not name the country');
  end if;

  -- Only model-supplied city values require model evidence here. Yerevan backed by a validated Yerevan district
  -- is established by the district itself (same rule as the derivation above).
  if v_property ? 'city'
     and (p_output -> 'fields' -> 'city' ->> 'value') is not null
     and not (lower(v_property ->> 'city') = 'yerevan' and v_yerevan_district) then
    v_city := lower(v_property ->> 'city');
    v_pattern := coalesce(c_city_aliases ->> v_city, '(' || regexp_replace(v_city, '([^[:alnum:][:space:]])', '\\\1', 'g') || ')');
    if extraction_evidence_text(p_output -> 'fields' -> 'city' ->> 'evidence') !~ v_pattern then
      v_property := v_property - 'city';
      v_issues := v_issues || extraction_issue('warning', 'unsupported_value_removed', 'city',
                                               'city evidence does not name the city');
    end if;
  end if;

  if v_property ? 'title' and lower(v_property ->> 'title') ~ 'bedroom' and not v_property ? 'bedrooms' then
    v_property := v_property - 'title';
    v_issues := v_issues || extraction_issue('warning', 'unsupported_value_removed', 'title',
                                             'title mentions bedrooms but bedrooms is not established');
  end if;

  for v_conflict in
    select c from jsonb_array_elements(coalesce(p_output -> 'conflicts', '[]'::jsonb)) c
     where c ->> 'resolution' = 'latest_correction'
  loop
    select max((e #>> '{}')::integer) into v_last from jsonb_array_elements(v_conflict -> 'source_messages') e;
    if extraction_evidence_text(p_input -> 'messages' -> (v_last - 1) ->> 'text') !~ c_correction_terms then
      v_name := v_conflict ->> 'field';
      v_property := v_property - v_name;
      v_forced := true;
      v_issues := v_issues || extraction_issue('review', 'correction_not_stated', v_name,
                                               'values differ and no message states a correction; treated as unresolved');
    end if;
  end loop;

  foreach v_name in array c_critical loop
    if not v_property ? v_name
       and not exists (select 1 from jsonb_array_elements(v_issues) i
                        where i ->> 'code' = 'missing_critical_field' and i ->> 'field' = v_name) then
      v_issues := v_issues || extraction_issue('review', 'missing_critical_field', v_name,
                                               'required before a listing could be created');
    end if;
  end loop;

  v_status := case
                when v_status = 'conflicting' or v_forced then 'conflicting'
                when exists (select 1 from unnest(c_critical) k where not v_property ? k) then 'incomplete'
                else 'valid'
              end;

  return v_result || jsonb_build_object('status', v_status, 'issues', v_issues, 'property', v_property);
end;
$function$;
