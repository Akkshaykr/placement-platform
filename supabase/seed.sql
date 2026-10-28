-- Development / first-run reference data: categories and topics only.
-- Contains no users, no challenges, no statistics and no credentials. Safe to run repeatedly.

insert into public.categories (slug, name, description, sort_order) values
  ('quantitative-aptitude', 'Quantitative aptitude', 'Arithmetic and numerical reasoning used in placement tests.', 10),
  ('logical-reasoning',     'Logical reasoning',     'Patterns, deduction and arrangement problems.', 20),
  ('verbal-ability',        'Verbal ability',        'Grammar, vocabulary and comprehension.', 30)
on conflict (slug) do nothing;

insert into public.topics (category_id, slug, name, sort_order)
select c.id, t.slug, t.name, t.sort_order
from (values
  ('quantitative-aptitude', 'time-speed-distance',     'Time, speed and distance',  10),
  ('quantitative-aptitude', 'percentages',             'Percentages',               20),
  ('quantitative-aptitude', 'profit-and-loss',         'Profit and loss',           30),
  ('quantitative-aptitude', 'ratio-and-proportion',    'Ratio and proportion',      40),
  ('quantitative-aptitude', 'time-and-work',           'Time and work',             50),
  ('quantitative-aptitude', 'averages',                'Averages',                  60),
  ('quantitative-aptitude', 'number-systems',          'Number systems',            70),
  ('quantitative-aptitude', 'permutation-combination', 'Permutation and combination', 80),
  ('quantitative-aptitude', 'probability',             'Probability',               90),
  ('logical-reasoning',     'number-series',           'Number series',             10),
  ('logical-reasoning',     'coding-decoding',         'Coding and decoding',       20),
  ('logical-reasoning',     'blood-relations',         'Blood relations',           30),
  ('logical-reasoning',     'seating-arrangement',     'Seating arrangement',       40),
  ('logical-reasoning',     'syllogisms',              'Syllogisms',                50),
  ('verbal-ability',        'reading-comprehension',   'Reading comprehension',     10),
  ('verbal-ability',        'sentence-correction',     'Sentence correction',       20),
  ('verbal-ability',        'synonyms-antonyms',       'Synonyms and antonyms',     30)
) as t (category_slug, slug, name, sort_order)
join public.categories c on c.slug = t.category_slug
on conflict (category_id, slug) do nothing;
