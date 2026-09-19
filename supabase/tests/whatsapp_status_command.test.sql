-- Deterministic regression test for public.whatsapp_status_command (Phase 8). Touches no data.
-- Run as a privileged role (e.g. the SQL editor or `psql`): raises an exception on the first mismatch,
-- otherwise returns 'whatsapp_status_command: N cases passed'.
do $$
declare
  c record;
  v_got jsonb;
  v_n integer := 0;
begin
  for c in select * from (values
    ('sold zz-test-flat',                                         '{"action":"sold","reference":"zz-test-flat"}'),
    ('SOLD: zz-test-flat.',                                       '{"action":"sold","reference":"zz-test-flat"}'),
    ('Sold ZZ-TEST-FLAT',                                         '{"action":"sold","reference":"zz-test-flat"}'),
    ('rented https://example.com/properties/zz-test-house?x=1',   '{"action":"rented","reference":"zz-test-house"}'),
    ('rented http://example.com:3000/properties/zz-test-house/',  '{"action":"rented","reference":"zz-test-house"}'),
    ('archive <zz-test-flat>',                                    '{"action":"archived","reference":"zz-test-flat"}'),
    ('remove zz-test-flat',                                       '{"action":"archived","reference":"zz-test-flat"}'),
    ('продано zz-test-flat',                                      '{"action":"sold","reference":"zz-test-flat"}'),
    ('сдано zz-test-flat',                                        '{"action":"rented","reference":"zz-test-flat"}'),
    ('վաճառված zz-test-flat',                                     '{"action":"sold","reference":"zz-test-flat"}'),
    ('sold',                                                      '{"action":"sold","problem":"missing_reference"}'),
    ('sold a b',                                                  '{"action":"sold","problem":"ambiguous_reference"}'),
    ('sold ../../etc',                                            '{"action":"sold","problem":"invalid_reference"}'),
    ('sold https://example.com/admin/properties/x',               '{"action":"sold","problem":"invalid_reference"}'),
    ('sold zz_test',                                              '{"action":"sold","problem":"invalid_reference"}')
  ) t(input, expected) loop
    v_got := public.whatsapp_status_command(c.input);
    if v_got is distinct from c.expected::jsonb then
      raise exception 'whatsapp_status_command(%) = %, expected %', c.input, v_got, c.expected;
    end if;
    v_n := v_n + 1;
  end loop;

  -- ordinary text is never a command (no fuzzy interpretation)
  for c in select * from (values
    ('For sale: 3-room apartment in Kentron'), ('sold 3 room apartment in Kentron'), ('done'), ('cancel'),
    ('archived zz-test-flat'), (''), (null)
  ) t(input) loop
    if public.whatsapp_status_command(c.input) is not null then
      raise exception 'whatsapp_status_command(%) should be null', c.input;
    end if;
    v_n := v_n + 1;
  end loop;
  raise notice 'whatsapp_status_command: % cases passed', v_n;
end $$;
