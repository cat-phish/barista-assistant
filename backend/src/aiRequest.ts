// What was sent to the AI (docs/api/analysis.md §8c) is only read on its own
// (GET …/request): analyses and suggestions are returned without it, saying
// whether there is one.
import { getTableColumns, sql } from "drizzle-orm";
import { llmAnalyses, parameterSuggestions, type LlmAnalysis, type ParameterSuggestion } from "@barista/shared/schema";

const { request: _analysisRequest, ...analysisColumns } = getTableColumns(llmAnalyses);
export const ANALYSIS_COLUMNS = { ...analysisColumns, hasRequest: sql<boolean>`${llmAnalyses.request} IS NOT NULL`.mapWith(Boolean) };
export type AnalysisRow = Omit<LlmAnalysis, "request"> & { hasRequest: boolean };

const { request: _suggestionRequest, ...suggestionColumns } = getTableColumns(parameterSuggestions);
export const SUGGESTION_COLUMNS = { ...suggestionColumns, hasRequest: sql<boolean>`${parameterSuggestions.request} IS NOT NULL`.mapWith(Boolean) };
export type SuggestionRow = Omit<ParameterSuggestion, "request"> & { hasRequest: boolean };
