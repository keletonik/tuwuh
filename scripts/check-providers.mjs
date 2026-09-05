/**
 * Provider catalogue gate.
 *
 * Every vendor in Settings must have its own default model, Hugging Face and
 * a local option must exist, and modelFor must not leak one vendor's id into
 * another.
 */
import { baseUrlFor, modelFor, PROVIDERS } from "../src/lib/providers.ts";

let failed = 0;
const fail = (m) => {
  failed += 1;
  console.log(`FAIL ${m}`);
};

if (PROVIDERS.length < 6) fail(`expected at least 6 providers, got ${PROVIDERS.length}`);

const ids = PROVIDERS.map((p) => p.id);
for (const need of ["anthropic", "openai", "xai", "openrouter", "huggingface", "ollama"]) {
  if (!ids.includes(need)) fail(`missing provider ${need}`);
}

const defaults = PROVIDERS.map((p) => p.defaultModel);
if (new Set(defaults).size !== defaults.length) {
  fail(`default models are not unique: ${defaults.join(", ")}`);
}

const hf = PROVIDERS.find((p) => p.id === "huggingface");
if (!hf?.needsKey) fail("huggingface must require a token");
if (!hf?.defaultBaseUrl?.includes("router.huggingface.co")) {
  fail("huggingface default base URL is not the router");
}

const local = PROVIDERS.find((p) => p.id === "ollama");
if (local?.needsKey) fail("ollama/local must not require a key");
if (!local?.defaultBaseUrl?.includes("11434")) fail("ollama default is not localhost:11434");

if (modelFor("ollama", {}) !== local.defaultModel) fail("modelFor empty map missed ollama default");
if (modelFor("anthropic", { anthropic: "claude-haiku-4.5" }) !== "claude-haiku-4.5") {
  fail("modelFor did not honour a stored anthropic model");
}
if (modelFor("openai", { anthropic: "claude-sonnet-5" }) !== PROVIDERS.find((p) => p.id === "openai").defaultModel) {
  fail("openai inherited the anthropic model");
}

for (const p of PROVIDERS) {
  if (!p.defaultBaseUrl) fail(`${p.id} has no default base URL`);
}

if (baseUrlFor("huggingface", { ollama: "http://localhost:11434/v1" }) !== "") {
  fail("huggingface inherited the ollama base URL");
}
if (baseUrlFor("ollama", { ollama: "http://127.0.0.1:8080/v1" }) !== "http://127.0.0.1:8080/v1") {
  fail("baseUrlFor did not honour a stored ollama URL");
}

if (failed) {
  console.log(`${failed} provider check(s) failed`);
  process.exit(1);
}
console.log(`ok   providers  ${PROVIDERS.length} vendors, unique defaults`);
