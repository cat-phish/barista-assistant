-- Suggest parameters' bean sources always meant this exact bean: they're the bag
-- sources now, and bean* means every bag of the coffee (docs/api/analysis.md §8b).
UPDATE `parameter_suggestions` SET `source` = CASE `source` WHEN 'bean' THEN 'bag' WHEN 'beanRecipe' THEN 'bagRecipe' WHEN 'beanBrewer' THEN 'bagBrewer' ELSE `source` END WHERE `source` IN ('bean', 'beanRecipe', 'beanBrewer');--> statement-breakpoint
-- A workspace keeps comparing with the bag, including one on the default (beanRecipe).
UPDATE `workspaces` SET `settings` = JSON_SET(COALESCE(`settings`, '{}'), '$.suggestSource', CASE JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.suggestSource')) WHEN 'bean' THEN 'bag' WHEN 'beanBrewer' THEN 'bagBrewer' WHEN 'brewer' THEN 'brewer' WHEN 'recipe' THEN 'recipe' ELSE 'bagRecipe' END);
