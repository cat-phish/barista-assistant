-- Repeat brews: the bean and recipe became choices, on by default
-- (docs/api/auth.md §1 repeatKeeps). Whoever saved their own repeat choices
-- keeps copying both, as a repeat always did; without a saved list, the
-- defaults already include them.
UPDATE `users` SET `preferences` = JSON_ARRAY_INSERT(JSON_ARRAY_INSERT(`preferences`, '$.repeatKeeps[0]', 'recipe'), '$.repeatKeeps[0]', 'bean')
WHERE JSON_TYPE(JSON_EXTRACT(`preferences`, '$.repeatKeeps')) = 'ARRAY'
  AND NOT JSON_CONTAINS(JSON_EXTRACT(`preferences`, '$.repeatKeeps'), '"bean"')
  AND NOT JSON_CONTAINS(JSON_EXTRACT(`preferences`, '$.repeatKeeps'), '"recipe"');
