import { geminiTranslator } from "./gemini"
import { mockTranslator } from "./mock"
import type { QueryTranslator } from "./types"

// Gemini when a key is configured (.env.local); the rule-based mock otherwise.
const apiKey = process.env.GEMINI_API_KEY

export const translator: QueryTranslator = apiKey ? geminiTranslator(apiKey) : mockTranslator
